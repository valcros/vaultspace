import { describe, expect, it, vi } from 'vitest';

import {
  buildStaleTokenWhere,
  runStaleTokenCleanup,
  type StaleTokenCleanupDb,
} from './staleTokenCleanup';

const NOW = new Date('2026-08-28T00:00:00.000Z');

describe('buildStaleTokenWhere', () => {
  it('selects expired-unused and old-consumed tokens, never live ones', () => {
    const where = buildStaleTokenWhere(NOW, 7) as {
      OR: Array<Record<string, unknown>>;
    };

    // Expired and never used.
    expect(where.OR[0]).toEqual({ usedAt: null, expiresAt: { lt: NOW } });
    // Consumed more than 7 days ago.
    const usedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(where.OR[1]).toEqual({ usedAt: { lt: usedCutoff } });
  });
});

function makeDb(count: number, deleted: number) {
  return {
    emailVerificationToken: {
      count: vi.fn().mockResolvedValue(count),
      deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
    },
  } satisfies StaleTokenCleanupDb;
}

describe('runStaleTokenCleanup', () => {
  it('dry-run counts without deleting', async () => {
    const db = makeDb(395, 0);

    const summary = await runStaleTokenCleanup({
      db,
      now: NOW,
      usedRetentionDays: 7,
      execute: false,
    });

    expect(summary).toEqual({ purgeable: 395, deleted: 0, dryRun: true });
    expect(db.emailVerificationToken.count).toHaveBeenCalledTimes(1);
    expect(db.emailVerificationToken.deleteMany).not.toHaveBeenCalled();
  });

  it('execute deletes and reports the count', async () => {
    const db = makeDb(395, 395);

    const summary = await runStaleTokenCleanup({
      db,
      now: NOW,
      usedRetentionDays: 7,
      execute: true,
    });

    expect(summary).toEqual({ purgeable: 395, deleted: 395, dryRun: false });
    expect(db.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: buildStaleTokenWhere(NOW, 7),
    });
  });

  it('is a no-op when nothing is purgeable', async () => {
    const db = makeDb(0, 0);

    const summary = await runStaleTokenCleanup({
      db,
      now: NOW,
      usedRetentionDays: 7,
      execute: true,
    });

    expect(summary).toEqual({ purgeable: 0, deleted: 0, dryRun: false });
  });
});
