/**
 * One-shot stale email-verification token cleanup runner.
 *
 * Intended for a lightweight scheduled Azure Container Apps Job (same pattern as
 * the invitation-lifecycle and delayed-job-waker jobs). Runs as the ordinary
 * app-role connection; `email_verification_tokens` has no RLS, so no privileged
 * connection is needed (and the worker is forbidden DATABASE_URL_ADMIN).
 *
 * Config:
 *   STALE_TOKEN_CLEANUP_EXECUTE      "true" to delete; anything else = dry-run.
 *   STALE_TOKEN_USED_RETENTION_DAYS  days to keep consumed tokens (default 7).
 */

import { bootstrapDb } from '@/lib/db';
import {
  runStaleTokenCleanup,
  type StaleTokenCleanupDb,
} from '@/lib/maintenance/staleTokenCleanup';

async function main() {
  const execute = process.env['STALE_TOKEN_CLEANUP_EXECUTE'] === 'true';
  const parsedRetention = Number.parseInt(
    process.env['STALE_TOKEN_USED_RETENTION_DAYS'] ?? '7',
    10
  );
  const usedRetentionDays =
    Number.isFinite(parsedRetention) && parsedRetention >= 0 ? parsedRetention : 7;

  const summary = await runStaleTokenCleanup({
    // On the worker, bootstrapDb resolves to the app-role DATABASE_URL (the
    // worker is forbidden DATABASE_URL_ADMIN). The token table has no RLS, so
    // the app role deletes directly. Cast to the narrow interface the lib needs.
    db: bootstrapDb as unknown as StaleTokenCleanupDb,
    now: new Date(),
    usedRetentionDays,
    execute,
  });

  console.log(JSON.stringify({ status: 'ok', summary }, null, 2));
}

main().catch((error) => {
  console.error('[StaleTokenCleanup] Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
