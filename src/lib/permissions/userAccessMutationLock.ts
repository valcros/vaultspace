import type { Prisma } from '@prisma/client';

/**
 * Serialize direct-user permission changes for one organization membership.
 *
 * Existing permission rows cannot protect an initially empty grant set from a
 * concurrent insert. A transaction-scoped PostgreSQL advisory lock gives every
 * participating direct-user permission writer one stable serialization point.
 */
export async function lockUserAccessMutation(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  organizationId: string,
  userId: string
): Promise<void> {
  const lockKey = `vaultspace:user-access:${organizationId}:${userId}`;
  // pg_advisory_xact_lock returns PostgreSQL's void type. Prisma cannot
  // deserialize that value through $queryRaw, while $executeRaw correctly
  // executes and waits for the transaction-scoped lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
