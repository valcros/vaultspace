/**
 * Invitation lifecycle: automated reminders + expiry.
 *
 * A still-unopened invitation gets a reminder email 48 hours after it was sent,
 * a second reminder one week after it was sent, and is deactivated (expired)
 * once its `expiresAt` passes (14 days by default, set at invite time).
 *
 * DESIGN NOTES
 * ------------
 * - Cross-tenant scan: `links` is RLS-protected, so this job MUST run against a
 *   bootstrap (RLS-bypassing) client. Org scoping is not required for sending —
 *   each link already carries its recipient in `allowedEmails` — but the room and
 *   inviter are joined in for the email body. This is a legitimate system-level
 *   use of the bootstrap client, exactly like the viewer info/access routes.
 * - Only invites we actually emailed (`inviteEmailSentAt != null`) are eligible
 *   for reminders. Links that were never emailed are never auto-reminded. This
 *   is the single property that prevents a mass re-send to real recipients.
 * - Idempotency (BullMQ / cron redelivery safe): guard columns are advanced
 *   BEFORE the email is sent. If a send crashes, the invite under-sends (one
 *   reminder instead of two) rather than double-emailing a recipient on a retry.
 *   Double-emailing an investor is the worse failure, so we bias against it.
 * - Reminder cadence is anchored on `inviteEmailSentAt`, not `createdAt`, so a
 *   resend (which re-stamps `inviteEmailSentAt` and resets `remindersSent`)
 *   correctly restarts the clock.
 */

import { buildReminderEmail } from '@/lib/email/inviteEmail';
import type { EmailProvider } from '@/providers/types';

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_FIRST_REMINDER_HOURS = 48;
export const DEFAULT_SECOND_REMINDER_HOURS = 24 * 7; // one week from the invite

/** Minimal shape of a link row this job needs. */
export interface LifecycleLink {
  id: string;
  slug: string;
  allowedEmails: string[];
  inviteeName: string | null;
  inviteMessage: string | null;
  expiresAt: Date | null;
  inviteEmailSentAt: Date | null;
  remindersSent: number;
  room: { name: string } | null;
  createdByUser: { firstName: string | null; lastName: string | null; email: string } | null;
}

/** Minimal client surface (satisfied by both the RLS-bypassing bootstrap client and a test double). */
export interface LifecycleDb {
  link: {
    findMany(args: unknown): Promise<LifecycleLink[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface InvitationLifecycleConfig {
  db: LifecycleDb;
  email: EmailProvider;
  /** Current time. Injected so the job is deterministic and testable. */
  now: Date;
  /** Origin for building the /view/<slug> access URL, e.g. https://brightside.vaultspace.org */
  baseUrl: string;
  firstReminderHours?: number;
  secondReminderHours?: number;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface InvitationLifecycleSummary {
  scanned: number;
  expired: number;
  firstRemindersSent: number;
  secondRemindersSent: number;
  errors: number;
}

function inviterNameOf(link: LifecycleLink): string {
  const u = link.createdByUser;
  if (!u) {
    return 'A colleague';
  }
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full || u.email;
}

/**
 * Run one lifecycle pass. Returns a summary of actions taken. Safe to call
 * repeatedly (idempotent): a link is expired once, and each reminder is sent
 * once because the guard columns advance before the send.
 */
export async function runInvitationLifecycle(
  config: InvitationLifecycleConfig
): Promise<InvitationLifecycleSummary> {
  const {
    db,
    email,
    now,
    baseUrl,
    firstReminderHours = DEFAULT_FIRST_REMINDER_HOURS,
    secondReminderHours = DEFAULT_SECOND_REMINDER_HOURS,
    logger = console,
  } = config;

  const summary: InvitationLifecycleSummary = {
    scanned: 0,
    expired: 0,
    firstRemindersSent: 0,
    secondRemindersSent: 0,
    errors: 0,
  };

  const firstCutoff = new Date(now.getTime() - firstReminderHours * HOUR_MS);
  const secondCutoff = new Date(now.getTime() - secondReminderHours * HOUR_MS);

  // Candidate links: active, never opened, and previously emailed. Ordering the
  // OR arms explicitly keeps the scan tight; per-row action is decided below.
  const select = {
    id: true,
    slug: true,
    allowedEmails: true,
    inviteeName: true,
    inviteMessage: true,
    expiresAt: true,
    inviteEmailSentAt: true,
    remindersSent: true,
    room: { select: { name: true } },
    createdByUser: { select: { firstName: true, lastName: true, email: true } },
  };

  const links = await db.link.findMany({
    where: {
      isActive: true,
      lastAccessedAt: null,
      inviteEmailSentAt: { not: null },
      OR: [
        // Expired: expiry has passed.
        { expiresAt: { lte: now } },
        // Due for first reminder.
        { remindersSent: 0, inviteEmailSentAt: { lte: firstCutoff } },
        // Due for second reminder.
        { remindersSent: 1, inviteEmailSentAt: { lte: secondCutoff } },
      ],
    },
    select,
    // Bound the batch so a single pass can't run unboundedly; the schedule
    // catches any remainder on the next tick.
    take: 500,
  });

  summary.scanned = links.length;

  for (const link of links) {
    try {
      // Expiry takes precedence and needs no email.
      if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) {
        await db.link.update({ where: { id: link.id }, data: { isActive: false } });
        summary.expired += 1;
        continue;
      }

      const sentAt = link.inviteEmailSentAt;
      if (!sentAt) {
        continue;
      } // guarded by the query, but keep the types honest

      const recipient = link.allowedEmails[0];
      if (!recipient) {
        continue;
      } // an invite link always carries its recipient

      const isFirst = link.remindersSent === 0 && sentAt.getTime() <= firstCutoff.getTime();
      const isSecond = link.remindersSent === 1 && sentAt.getTime() <= secondCutoff.getTime();
      if (!isFirst && !isSecond) {
        continue;
      }

      // Advance the guard columns BEFORE sending (idempotency: crash → under-send,
      // never double-send). remindersSent moves 0→1 or 1→2 exactly once.
      await db.link.update({
        where: { id: link.id },
        data: { remindersSent: link.remindersSent + 1, lastReminderAt: now },
      });

      const { subject, html } = buildReminderEmail({
        roomName: link.room?.name ?? 'a data room',
        inviterName: inviterNameOf(link),
        inviteeName: link.inviteeName,
        message: link.inviteMessage,
        link: `${baseUrl}/view/${link.slug}`,
        expiresAt: link.expiresAt,
      });
      await email.sendEmail({ to: recipient, subject, html });

      if (isFirst) {
        summary.firstRemindersSent += 1;
      } else {
        summary.secondRemindersSent += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logger.error(`[InvitationLifecycle] Failed processing link ${link.id}:`, err);
    }
  }

  logger.log(`[InvitationLifecycle] ${JSON.stringify(summary)}`);
  return summary;
}
