/**
 * One-shot invitation lifecycle runner.
 *
 * Intended for a lightweight scheduled Azure Container Apps Job (same pattern as
 * the delayed-job waker). Each run sends due reminder emails for still-unopened
 * invitations (48h and 1 week after invite) and expires invitations past their
 * `expiresAt`.
 *
 * The scan spans all organizations, so it uses the RLS-bypassing bootstrap
 * client. See src/lib/invitations/invitationLifecycle.ts for the safety model.
 */

import { bootstrapDb } from '@/lib/db';
import { runInvitationLifecycle, type LifecycleDb } from '@/lib/invitations/invitationLifecycle';
import { getProviders } from '@/providers';

async function main() {
  const baseUrl = process.env['APP_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'];
  if (!baseUrl) {
    console.error('[InvitationLifecycle] APP_URL is required to build access links');
    process.exitCode = 1;
    return;
  }

  const email = getProviders().email;

  const summary = await runInvitationLifecycle({
    // bootstrapDb is a full PrismaClient; the lib narrows to the RLS-bypassing
    // subset it needs. Prisma's overloaded findMany isn't structurally
    // assignable to the simplified signature, so cast to the narrow interface.
    db: bootstrapDb as unknown as LifecycleDb,
    email,
    now: new Date(),
    baseUrl: baseUrl.replace(/\/$/, ''),
  });

  console.log(JSON.stringify({ status: summary.errors > 0 ? 'partial' : 'ok', summary }, null, 2));

  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    '[InvitationLifecycle] Fatal error:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
