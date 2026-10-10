/**
 * Read-only release and operational gate for SysOp continuity.
 *
 * Usage:
 *   npm run ops:verify-platform-operator
 *
 * Requires DATABASE_URL_ADMIN, MIGRATION_DATABASE_URL, or DATABASE_URL. The
 * command emits only the active-operator count, never account identities or
 * connection details, and exits non-zero when no active platform operator is
 * present.
 */

import { Prisma, PrismaClient } from '@prisma/client';

import {
  assertActivePlatformOperatorCount,
  assertSysopRolloutReadiness,
  resolvePlatformOperatorDatabaseUrl,
} from '../src/lib/sysop/platformOperatorPreflight';

const datasourceUrl = resolvePlatformOperatorDatabaseUrl(process.env);

if (!datasourceUrl) {
  throw new Error(
    'Platform-operator verification requires DATABASE_URL_ADMIN, MIGRATION_DATABASE_URL, or DATABASE_URL.'
  );
}

const prisma = new PrismaClient({ datasourceUrl });

async function main(): Promise<void> {
  const activeOperatorCount = await prisma.user.count({
    where: { isActive: true, isPlatformOperator: true },
  });

  assertActivePlatformOperatorCount(activeOperatorCount);
  console.log(`Platform operator continuity verified: ${activeOperatorCount} active operator(s).`);

  const loginReadyOperator: Prisma.UserWhereInput = {
    isActive: true,
    isPlatformOperator: true,
    emailVerifiedAt: { not: null },
    twoFactorEnabled: true,
    twoFactorSecret: { not: null },
    organizations: { some: { isActive: true, organization: { isActive: true } } },
  };
  const [activeMfaOperators, consoleReadyOperators, capabilityManagers] = await Promise.all([
    prisma.user.count({ where: loginReadyOperator }),
    prisma.user.count({
      where: {
        ...loginReadyOperator,
        platformCapabilityGrants: {
          some: { capability: 'SYSOP_CONSOLE_ACCESS', revokedAt: null },
        },
      },
    }),
    prisma.user.count({
      where: {
        ...loginReadyOperator,
        platformCapabilityGrants: {
          some: { capability: 'SYSOP_OPERATOR_MANAGE', revokedAt: null },
        },
      },
    }),
  ]);
  const readiness = { activeMfaOperators, consoleReadyOperators, capabilityManagers };
  assertSysopRolloutReadiness(readiness, process.env);
  console.log(
    `SysOp rollout readiness: ${activeMfaOperators} MFA operator(s), ` +
      `${consoleReadyOperators} console-ready operator(s), ${capabilityManagers} capability manager(s).`
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Platform-operator verification failed.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
