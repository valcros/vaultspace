import { describe, expect, it, vi } from 'vitest';

import {
  runInvitationLifecycle,
  type LifecycleLink,
  type LifecycleDb,
} from './invitationLifecycle';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-07-15T12:00:00.000Z');

function link(overrides: Partial<LifecycleLink> = {}): LifecycleLink {
  return {
    id: 'link-1',
    slug: 'slug-1',
    allowedEmails: ['investor@example.com'],
    inviteeName: 'Investor One',
    inviteMessage: null,
    expiresAt: new Date(NOW.getTime() + 10 * 24 * HOUR),
    inviteEmailSentAt: new Date(NOW.getTime() - 3 * 24 * HOUR),
    remindersSent: 0,
    room: { name: 'Series A Room' },
    createdByUser: { firstName: 'Alice', lastName: 'Admin', email: 'alice@fund.com' },
    ...overrides,
  };
}

function makeDb(rows: LifecycleLink[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const db: LifecycleDb = {
    link: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn(async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return {};
      }),
    },
  };
  return { db, updates };
}

function makeEmail() {
  return { sendEmail: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
}

const base = {
  now: NOW,
  baseUrl: 'https://x.vaultspace.org',
  logger: { log: vi.fn(), error: vi.fn() },
};

describe('runInvitationLifecycle', () => {
  it('sends a first reminder for an unopened invite older than 48h and advances remindersSent before send', async () => {
    const { db, updates } = makeDb([link({ remindersSent: 0 })]);
    const email = makeEmail();

    const summary = await runInvitationLifecycle({ db, email, ...base });

    expect(summary.firstRemindersSent).toBe(1);
    expect(summary.secondRemindersSent).toBe(0);
    expect(summary.expired).toBe(0);
    // Guard column advanced 0 -> 1
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data['remindersSent']).toBe(1);
    expect(updates[0]!.data['lastReminderAt']).toEqual(NOW);
    // Email actually sent to the invitee
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0]![0].to).toBe('investor@example.com');
    expect(email.sendEmail.mock.calls[0]![0].subject).toContain('Reminder');
  });

  it('sends a second reminder when remindersSent is 1 and invite is older than a week', async () => {
    const { db, updates } = makeDb([
      link({ remindersSent: 1, inviteEmailSentAt: new Date(NOW.getTime() - 8 * 24 * HOUR) }),
    ]);
    const email = makeEmail();

    const summary = await runInvitationLifecycle({ db, email, ...base });

    expect(summary.secondRemindersSent).toBe(1);
    expect(summary.firstRemindersSent).toBe(0);
    expect(updates[0]!.data['remindersSent']).toBe(2);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('expires an invite past expiresAt without sending email', async () => {
    const { db, updates } = makeDb([
      link({ expiresAt: new Date(NOW.getTime() - HOUR), remindersSent: 0 }),
    ]);
    const email = makeEmail();

    const summary = await runInvitationLifecycle({ db, email, ...base });

    expect(summary.expired).toBe(1);
    expect(summary.firstRemindersSent).toBe(0);
    expect(updates[0]!.data['isActive']).toBe(false);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('under-sends (does not double-send) when the email throws after the guard advanced', async () => {
    const { db, updates } = makeDb([link({ remindersSent: 0 })]);
    const email = { sendEmail: vi.fn().mockRejectedValue(new Error('smtp down')) };

    const summary = await runInvitationLifecycle({ db, email, ...base });

    // Counted as an error, not a sent reminder; the guard column already moved,
    // so a redelivery will not re-send this reminder.
    expect(summary.errors).toBe(1);
    expect(summary.firstRemindersSent).toBe(0);
    expect(updates[0]!.data['remindersSent']).toBe(1);
  });

  it('does not send a reminder before the 48h threshold', async () => {
    // A row younger than 48h should not be returned by the query in production;
    // guard the per-row logic too in case the query is loosened.
    const { db } = makeDb([
      link({ remindersSent: 0, inviteEmailSentAt: new Date(NOW.getTime() - 10 * HOUR) }),
    ]);
    const email = makeEmail();

    const summary = await runInvitationLifecycle({ db, email, ...base });

    expect(summary.firstRemindersSent).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('scopes the scan to active, unopened, previously-emailed invites', async () => {
    const { db } = makeDb([]);
    const email = makeEmail();

    await runInvitationLifecycle({ db, email, ...base });

    const where = (db.link.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(where.isActive).toBe(true);
    expect(where.lastAccessedAt).toBeNull();
    expect(where.inviteEmailSentAt).toEqual({ not: null });
  });
});
