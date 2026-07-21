/**
 * One-shot worker: deliver initial invitation emails to invite links that were
 * created before automated email sending was wired up (inviteEmailSentAt IS NULL).
 *
 * Safe to run multiple times: only processes links where inviteEmailSentAt is null,
 * and the stamp is set before the next link is processed so a crash leaves at most
 * one duplicate send (initial invite, not a reminder — acceptable for a one-off
 * catch-up job).
 *
 * Requires: APP_URL, DATABASE_URL_ADMIN, EMAIL_PROVIDER + provider credentials.
 */

import { bootstrapDb } from '@/lib/db';
// Build ONLY the email provider (see invitationLifecycle.ts): getProviders()
// eagerly constructs storage too, which aborts in Azure mode for a job with no
// storage config.
import { createEmailProvider } from '@/providers';
import { buildInviteEmail } from '@/lib/email/inviteEmail';

async function main() {
  const baseUrl = process.env['APP_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'];
  if (!baseUrl) {
    console.error('[SendPendingInvites] APP_URL is required to build access links');
    process.exitCode = 1;
    return;
  }

  const email = createEmailProvider();

  const links = await bootstrapDb.link.findMany({
    where: {
      isActive: true,
      inviteEmailSentAt: null,
      allowedEmails: { isEmpty: false },
    },
    select: {
      id: true,
      slug: true,
      allowedEmails: true,
      inviteeName: true,
      inviteMessage: true,
      expiresAt: true,
      room: { select: { name: true } },
      createdByUser: { select: { firstName: true, lastName: true, email: true } },
    },
    take: 500,
  });

  console.log(`[SendPendingInvites] Found ${links.length} pending uninvited link(s)`);

  let sent = 0;
  let errors = 0;

  for (const link of links) {
    const recipient = link.allowedEmails[0];
    if (!recipient) {
      continue;
    }

    const u = link.createdByUser;
    const inviterName = u
      ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email
      : 'A colleague';

    const { subject, html } = buildInviteEmail({
      roomName: link.room?.name ?? 'a data room',
      inviterName,
      inviteeName: link.inviteeName,
      message: link.inviteMessage,
      link: `${baseUrl.replace(/\/$/, '')}/view/${link.slug}`,
      expiresAt: link.expiresAt,
    });

    const sentAt = new Date();
    try {
      await email.sendEmail({ to: recipient, subject, html });
      await bootstrapDb.link.update({
        where: { id: link.id },
        data: { inviteEmailSentAt: sentAt, remindersSent: 0 },
      });
      console.log(`[SendPendingInvites] Sent to ${recipient} (link ${link.id})`);
      sent += 1;
    } catch (err) {
      console.error(`[SendPendingInvites] Failed for ${recipient} (link ${link.id}):`, err);
      errors += 1;
    }
  }

  const summary = { scanned: links.length, sent, errors };
  console.log(JSON.stringify({ status: errors > 0 ? 'partial' : 'ok', summary }, null, 2));

  if (errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    '[SendPendingInvites] Fatal error:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
