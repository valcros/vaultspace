/**
 * Stale email-verification token cleanup (P2, token scope).
 *
 * Purges email-verification tokens that can never again be used:
 *   - expired and never consumed (usedAt IS NULL AND expiresAt < now), and
 *   - consumed a while ago (usedAt older than the retention window).
 *
 * `email_verification_tokens` has no row-level security, so the ordinary
 * app-role connection can delete directly — no SECURITY DEFINER, no migration,
 * no advisory lock. Deletion only ever targets already-expired/used tokens, so
 * it cannot race a live verification (which requires an unexpired, unused token).
 *
 * Deleting inert unverified USERS is deliberately out of scope: that touches
 * FORCE-RLS tables and needs a privileged, DB-clone-validated path. This job
 * only cleans tokens.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StaleTokenCleanupDb {
  emailVerificationToken: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

export interface StaleTokenCleanupOptions {
  db: StaleTokenCleanupDb;
  now: Date;
  /** Consumed tokens are kept this many days for audit, then purged. */
  usedRetentionDays: number;
  /** false (default) counts only and deletes nothing. */
  execute: boolean;
}

export interface StaleTokenCleanupSummary {
  purgeable: number;
  deleted: number;
  dryRun: boolean;
}

/**
 * Build the WHERE selecting only tokens that can never be used again. A live
 * token (unused and unexpired) never matches, so this is safe to run anytime.
 */
export function buildStaleTokenWhere(
  now: Date,
  usedRetentionDays: number
): Record<string, unknown> {
  const usedCutoff = new Date(now.getTime() - usedRetentionDays * MS_PER_DAY);
  return {
    OR: [
      // Expired and never consumed.
      { usedAt: null, expiresAt: { lt: now } },
      // Consumed longer ago than the retention window.
      { usedAt: { lt: usedCutoff } },
    ],
  };
}

export async function runStaleTokenCleanup(
  options: StaleTokenCleanupOptions
): Promise<StaleTokenCleanupSummary> {
  const { db, now, usedRetentionDays, execute } = options;
  const where = buildStaleTokenWhere(now, usedRetentionDays);

  const purgeable = await db.emailVerificationToken.count({ where });

  if (!execute) {
    return { purgeable, deleted: 0, dryRun: true };
  }

  // deleteMany is a single, idempotent DELETE bounded by the WHERE; a re-run
  // removes nothing new.
  const { count } = await db.emailVerificationToken.deleteMany({ where });
  return { purgeable, deleted: count, dryRun: false };
}
