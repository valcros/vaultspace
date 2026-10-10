/**
 * Out-of-band platform capability management. The database operator identity
 * is supplied through DATABASE_URL_ADMIN; this command never accepts secrets
 * as command-line arguments. The named actor is recorded in the platform
 * ledger but must also be verified by the operator running this command.
 *
 * Examples:
 *   npm run ops:platform-capability -- --list
 *   npm run ops:platform-capability -- --grant --actor-email actor@example.test \
 *     --target-email target@example.test --capability SYSOP_CONSOLE_ACCESS \
 *     --reason OWNER_VERIFIED
 * The first capability manager is seeded by granting SYSOP_OPERATOR_MANAGE to
 * the named actor with --bootstrap-manager --incident-ref <ticket>. Subsequent
 * changes require that actor to hold SYSOP_OPERATOR_MANAGE.
 *   npm run ops:platform-capability -- --revoke --actor-email actor@example.test \
 *     --target-email target@example.test --capability SYSOP_CONSOLE_ACCESS \
 *     --reason ROLE_CHANGED
 */
import { randomUUID } from 'node:crypto';
import { PlatformCapability, Prisma, PrismaClient } from '@prisma/client';

const url = process.env['DATABASE_URL_ADMIN'];
if (!url) {
  throw new Error('DATABASE_URL_ADMIN is required for platform capability management');
}
const prisma = new PrismaClient({ datasourceUrl: url });

function argument(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function emailHint(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function normalizeEmail(input: string | undefined): string {
  const email = input?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid --actor-email and --target-email are required');
  }
  return email;
}

async function list() {
  const grants = await prisma.platformCapabilityGrant.findMany({
    where: { revokedAt: null },
    include: { user: { select: { email: true, isActive: true, isPlatformOperator: true } } },
    orderBy: [{ userId: 'asc' }, { capability: 'asc' }],
  });
  for (const grant of grants) {
    console.log(
      `${emailHint(grant.user.email)} ${grant.capability} ${
        grant.user.isActive && grant.user.isPlatformOperator ? 'eligible' : 'inactive'
      }`
    );
  }
  console.log(`${grants.length} active capability grant(s).`);
}

async function mutate() {
  const args = process.argv.slice(2);
  const grantRequested = args.includes('--grant');
  const revokeRequested = args.includes('--revoke');
  if (grantRequested === revokeRequested) {
    throw new Error('Specify exactly one of --grant or --revoke');
  }
  const actorEmail = normalizeEmail(argument('--actor-email'));
  const targetEmail = normalizeEmail(argument('--target-email'));
  const capabilityValue = argument('--capability');
  if (!capabilityValue || !(capabilityValue in PlatformCapability)) {
    throw new Error('Specify a named PlatformCapability with --capability');
  }
  const capability = capabilityValue as PlatformCapability;
  const reason = argument('--reason');
  if (!reason || !/^[A-Z][A-Z0-9_]{2,63}$/.test(reason)) {
    throw new Error('Specify an uppercase reason code with --reason');
  }
  if (actorEmail === targetEmail && revokeRequested && capability === 'SYSOP_OPERATOR_MANAGE') {
    throw new Error('An operator cannot revoke their own capability-management authority');
  }
  const bootstrapManager = args.includes('--bootstrap-manager');
  const incidentRef = argument('--incident-ref');
  if (incidentRef && !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/.test(incidentRef)) {
    throw new Error('Incident reference format is invalid');
  }
  if (
    bootstrapManager &&
    (!grantRequested ||
      capability !== 'SYSOP_OPERATOR_MANAGE' ||
      actorEmail !== targetEmail ||
      !incidentRef)
  ) {
    throw new Error(
      'First-manager bootstrap requires a self-grant of SYSOP_OPERATOR_MANAGE and --incident-ref'
    );
  }

  const changed = await prisma.$transaction(
    async (tx) => {
      // Serialize all out-of-band grant changes, including first-manager
      // bootstrap when no grant row yet exists to lock.
      await tx.$queryRaw`SELECT 1 AS locked WHERE pg_advisory_xact_lock(553742852742132001) IS NULL`;
      const [actor, target] = await Promise.all([
        tx.user.findUnique({
          where: { email: actorEmail },
          select: { id: true, isActive: true, isPlatformOperator: true },
        }),
        tx.user.findUnique({
          where: { email: targetEmail },
          select: { id: true, isActive: true, isPlatformOperator: true },
        }),
      ]);
      if (!actor?.isActive || !actor.isPlatformOperator) {
        throw new Error('Named actor is not an active platform operator');
      }
      if (!target || (grantRequested && (!target.isActive || !target.isPlatformOperator))) {
        throw new Error('Target must exist and be an active platform operator for grants');
      }

      const actorManager = await tx.platformCapabilityGrant.findFirst({
        where: {
          userId: actor.id,
          capability: 'SYSOP_OPERATOR_MANAGE',
          revokedAt: null,
        },
        select: { id: true },
      });
      if (bootstrapManager) {
        const managerCount = await tx.platformCapabilityGrant.count({
          where: {
            capability: 'SYSOP_OPERATOR_MANAGE',
            revokedAt: null,
            user: { isActive: true, isPlatformOperator: true },
          },
        });
        if (managerCount !== 0) {
          throw new Error('A capability manager already exists; use a manager account');
        }
      } else if (!actorManager) {
        throw new Error('Named actor lacks SYSOP_OPERATOR_MANAGE');
      }

      // All changes for the same target serialize, preventing duplicate active
      // grants even though the table retains revoked grant history.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM public.users WHERE id = ${target.id}::text FOR UPDATE
      `);
      if (revokeRequested && capability === 'SYSOP_OPERATOR_MANAGE') {
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM public.platform_capability_grants
          WHERE capability = 'SYSOP_OPERATOR_MANAGE' AND "revokedAt" IS NULL
          ORDER BY id FOR UPDATE
        `);
      }
      const active = await tx.platformCapabilityGrant.findMany({
        where: { userId: target.id, capability, revokedAt: null },
        select: { id: true },
      });
      if (grantRequested && active.length > 0) {
        return false;
      }
      if (revokeRequested && active.length === 0) {
        return false;
      }

      if (
        revokeRequested &&
        capability === 'SYSOP_OPERATOR_MANAGE' &&
        target.isActive &&
        target.isPlatformOperator
      ) {
        const managers = await tx.platformCapabilityGrant.count({
          where: {
            capability: 'SYSOP_OPERATOR_MANAGE',
            revokedAt: null,
            user: { isActive: true, isPlatformOperator: true },
          },
        });
        if (managers <= 1) {
          throw new Error('Cannot revoke the last active capability manager');
        }
      }

      let changedGrantIds: string[];
      if (grantRequested) {
        const grant = await tx.platformCapabilityGrant.create({
          data: {
            userId: target.id,
            capability,
            grantedByUserId: actor.id,
            grantReasonCode: reason,
            incidentRef: incidentRef ?? null,
          },
        });
        changedGrantIds = [grant.id];
      } else {
        await tx.platformCapabilityGrant.updateMany({
          where: { userId: target.id, capability, revokedAt: null },
          data: { revokedAt: new Date(), revokedByUserId: actor.id, revokeReasonCode: reason },
        });
        changedGrantIds = active.map((grant) => grant.id);
      }
      for (const grantId of changedGrantIds) {
        await tx.platformAuditEvent.create({
          data: {
            action: grantRequested ? 'SYSOP_CAPABILITY_GRANTED' : 'SYSOP_CAPABILITY_REVOKED',
            actorUserId: actor.id,
            targetUserId: target.id,
            requestId: `ops_capability_${randomUUID()}`,
            correlationId: grantId,
            reasonCode: reason,
            incidentRef: incidentRef ?? null,
            breakGlass: bootstrapManager,
            changedFields: ['operator.capability'],
            previousState: grantRequested ? 'UNGRANTED' : 'GRANTED',
            nextState: grantRequested ? 'GRANTED' : 'REVOKED',
          },
        });
      }
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  console.log(changed ? 'Capability change and audit committed.' : 'No capability change needed.');
}

(process.argv.includes('--list') ? list() : mutate())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Capability operation failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
