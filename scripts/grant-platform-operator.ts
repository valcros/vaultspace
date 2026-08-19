/**
 * Grant or revoke the platform-operator flag for the cross-tenant SysOp
 * control plane (/sysop, /api/sysop/*).
 *
 * This flag is a platform-level grant, deliberately independent of org role.
 * Managing it is intentionally an out-of-band operator action, not an in-app UI.
 *
 * Usage:
 *   tsx scripts/grant-platform-operator.ts <email>            # grant
 *   tsx scripts/grant-platform-operator.ts <email> --revoke   # revoke
 *   tsx scripts/grant-platform-operator.ts --list             # list operators
 *
 * Requires DATABASE_URL (or DATABASE_URL_ADMIN) in the environment.
 */

import { PrismaClient } from '@prisma/client';

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
        console.log(`  ${op.email}${op.isActive ? '' : '  (INACTIVE — access denied)'}`);
      }
    }
    return;
  }

  const email = args.find((a) => !a.startsWith('--'));
  const revoke = args.includes('--revoke');

  if (!email) {
    console.error('Error: provide an email, or use --list.');
    console.error('Usage: tsx scripts/grant-platform-operator.ts <email> [--revoke] | --list');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isPlatformOperator: true },
  });

  if (!user) {
    console.error(`Error: no user found with email "${email}".`);
    process.exitCode = 1;
    return;
  }

  const nextValue = !revoke;
  if (user.isPlatformOperator === nextValue) {
    console.log(
      `No change: ${email} is already ${nextValue ? 'a platform operator' : 'not a platform operator'}.`
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformOperator: nextValue },
  });

  console.log(`${nextValue ? 'Granted' : 'Revoked'} platform-operator access for ${email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
