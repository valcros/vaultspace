/** Synthetic staging AI corpus controls. Never accepts customer rooms. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readAiRoomCoverage } from '../src/lib/ai/coverage';
import { withOrgContext } from '../src/lib/db';
import { reconcileAiRoom } from '../src/lib/ai/reconciliation';

type Mode = '--status' | '--enable' | '--reconcile' | '--disable' | '--disable-org';

async function main() {
  const [mode, organizationId, roomId] = process.argv.slice(2) as [Mode?, string?, string?];
  if (
    !mode ||
    !new Set(['--status', '--enable', '--reconcile', '--disable', '--disable-org']).has(mode) ||
    !organizationId ||
    !roomId
  ) {
    throw new Error(
      'Usage: ai-query-phase1-qa.ts --status|--enable|--reconcile|--disable|--disable-org <organizationId> <roomId>'
    );
  }
  const databaseUrl = process.env['DATABASE_URL'];
  const expectedHost = process.env['AI_QA_STAGING_DB_HOST'];
  if (
    !databaseUrl ||
    !expectedHost ||
    !expectedHost.endsWith('.postgres.database.azure.com') ||
    !expectedHost.includes('staging')
  ) {
    throw new Error('AI_QA_STAGING_DB_HOST_REQUIRED');
  }
  const target = new URL(databaseUrl);
  if (target.hostname !== expectedHost || target.pathname !== '/vaultspace') {
    throw new Error('AI_QA_DATABASE_TARGET_INVALID');
  }
  if (mode !== '--status' && process.env['AI_QA_AI_INDEX_APPLY'] !== 'synthetic-staging-only') {
    throw new Error('AI_QA_AI_INDEX_APPLY_REQUIRED');
  }
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), 'qa/ai-query/fixture-manifest.json'), 'utf8')
  ) as {
    fixtureSet: string;
    organizations: Array<{ key: string; name: string; slug: string }>;
    rooms: Array<{
      organization: string;
      name: string;
      slug: string;
      status: string;
      mode: string;
    }>;
  };
  if (manifest.fixtureSet !== 'vaultspace-ai-query-phase0')
    throw new Error('AI_QA_MANIFEST_INVALID');
  const verified = await withOrgContext(organizationId, async (tx) => {
    const organization = await tx.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, slug: true },
    });
    const room = await tx.room.findFirst({
      where: { id: roomId, organizationId },
      select: { name: true, slug: true, status: true, mode: true },
    });
    if (!organization || !room) throw new Error('AI_QA_SCOPE_NOT_FOUND');
    const orgSpec = manifest.organizations.find(
      (item) => item.slug === organization.slug && item.name === organization.name
    );
    const roomSpec = manifest.rooms.find(
      (item) =>
        item.organization === orgSpec?.key && item.slug === room.slug && item.name === room.name
    );
    if (
      !orgSpec ||
      !roomSpec ||
      roomSpec.status !== 'ACTIVE' ||
      roomSpec.mode !== 'INDEPENDENT' ||
      room.status !== 'ACTIVE' ||
      room.mode !== 'INDEPENDENT'
    ) {
      throw new Error('AI_QA_SCOPE_NOT_SYNTHETIC_ACTIVE');
    }
    return { organization: organization.slug, room: room.slug };
  });
  if (mode === '--enable' || mode === '--disable') {
    await withOrgContext(organizationId, async (tx) => {
      if (mode === '--enable') {
        await tx.organization.update({ where: { id: organizationId }, data: { aiEnabled: true } });
      }
      await tx.aiPolicy.upsert({
        where: { roomId },
        create: { organizationId, roomId, enabled: mode === '--enable' },
        update: { enabled: mode === '--enable' },
      });
    });
  }
  if (mode === '--disable-org') {
    await withOrgContext(organizationId, (tx) =>
      tx.organization.update({ where: { id: organizationId }, data: { aiEnabled: false } })
    );
  }
  const result =
    mode === '--reconcile'
      ? await reconcileAiRoom(organizationId, roomId)
      : await readAiRoomCoverage(organizationId, roomId);
  process.stdout.write(`${JSON.stringify({ mode, ...verified, ...result })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'AI_QA_OPERATION_FAILED'}\n`);
  process.exitCode = 1;
});
