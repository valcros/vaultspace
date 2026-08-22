/**
 * Grant or revoke the platform-operator flag for the cross-tenant SysOp
 * control plane (/sysop, /api/sysop/*).
 *
 * This flag is a platform-level grant, deliberately independent of org role.
 * Managing it is intentionally an out-of-band operator action, not an in-app UI.
 *
 * Usage:
 *   tsx scripts/grant-platform-operator.ts <email>            # grant
 *   tsx scripts/grant-platform-operator.ts <email> --revoke   # revoke (not the last active operator)
 *   tsx scripts/grant-platform-operator.ts <email> --revoke --allow-last-active-revoke
 *                                                        # audited break-glass revoke only
 *   tsx scripts/grant-platform-operator.ts --list             # list operators
 *
 * Requires DATABASE_URL (or DATABASE_URL_ADMIN) in the environment.
 */

import { PrismaClient } from '@prisma/client';

import { assertLastActivePlatformOperatorIsRetained } from '../src/lib/sysop/platformOperatorPreflight';

const prisma = new PrismaClient({
  datasourceUrl: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'],
});

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const operators = await prisma.user.findMany({
      where: { isPlatformOperator: true },
      select: { email: true, isActive: true },
      orderBy: { email: 'asc' },
    });
    if (operators.length === 0) {
      console.log('No platform operators are currently granted.');
    } else {
      console.log(`Platform operators (${operators.length}):`);
      for (const op of operators) {
        const [localPart, domain] = op.email.split('@');
        const emailHint = `${(localPart ?? '').slice(0, 2)}***@${domain ?? 'unknown'}`;
        console.log(`  ${emailHint}${op.isActive ? '' : '  (INACTIVE, access denied)'}`);
      }
    }
    return;
  }

  const email = args.find((a) => !a.startsWith('--'));
  const revoke = args.includes('--revoke');
  const allowLastActiveRevoke = args.includes('--allow-last-active-revoke');

  if (!email) {
    console.error('Error: provide an email, or use --list.');
    console.error(
      'Usage: tsx scripts/grant-platform-operator.ts <email> [--revoke] [--allow-last-active-revoke] | --list'
    );
    process.exitCode = 1;
    return;
  }

  const nextValue = !revoke;
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true, isPlatformOperator: true },
    });

    if (!user) {
      return { status: 'not_found' as const };
    }
    if (user.isPlatformOperator === nextValue) {
      return { status: 'unchanged' as const };
    }

    if (revoke && user.isActive && user.isPlatformOperator && !allowLastActiveRevoke) {
      // Lock every currently usable operator before counting. Concurrent revoke
      // commands therefore serialize instead of both passing a stale count.
      await tx.$queryRaw`
        SELECT id
        FROM users
        WHERE "isActive" = true AND "isPlatformOperator" = true
        FOR UPDATE`;
      const activeOperatorCount = await tx.user.count({
        where: { isActive: true, isPlatformOperator: true },
      });
      assertLastActivePlatformOperatorIsRetained(activeOperatorCount);
    }

    await tx.user.update({
      where: { id: user.id },
      data: { isPlatformOperator: nextValue },
    });

    // Find the user's primary organization for audit logging.
    const userOrg = await tx.userOrganization.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
    });

    if (userOrg?.organizationId) {
      await tx.event.create({
        data: {
          organizationId: userOrg.organizationId,
          eventType: nextValue ? 'PLATFORM_OPERATOR_GRANTED' : 'PLATFORM_OPERATOR_REVOKED',
          actorType: 'SYSTEM',
          actorEmail: email,
          requestId: `ops_grant_${Date.now()}`,
          description: `Platform operator access ${nextValue ? 'granted' : 'revoked'} for ${email}`,
          metadata: {
            targetEmail: email,
            targetUserId: user.id,
            granted: nextValue,
            source: 'ops-cli',
            breakGlass: revoke && allowLastActiveRevoke,
          },
        },
      });
    }

    return { status: 'changed' as const };
  });

  if (result.status === 'not_found') {
    console.error('Error: no user found for the supplied email address.');
    process.exitCode = 1;
    return;
  }
  if (result.status === 'unchanged') {
    console.log(
      `No change: account is already ${nextValue ? 'a platform operator' : 'not a platform operator'}.`
    );
    return;
  }

  console.log(`${nextValue ? 'Granted' : 'Revoked'} platform-operator access.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
