/**
 * Prisma Client Singleton
 *
 * This module provides a singleton instance of the Prisma client
 * to prevent multiple connections during development hot reloading.
 *
 * RLS Support:
 * - In production, use `withOrgContext()` to wrap queries with RLS context
 * - This sets `app.current_org_id` via SET LOCAL for the transaction
 * - All org-scoped queries will be filtered by RLS policies
 */

import { PrismaClient, Prisma } from '@prisma/client';

declare global {
  // Allow global `var` declarations for singleton pattern
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const db =
  globalThis.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.prisma = db;
}

declare global {
  // eslint-disable-next-line no-var
  var prismaBootstrap: PrismaClient | undefined;
}

/**
 * Bootstrap Prisma client — connects via DATABASE_URL_ADMIN when set.
 *
 * Use this ONLY for the small set of pre-session operations that legitimately
 * need to read or write across organizations: login user lookup, registration
 * (creating the very first user/org/UserOrganization triple), and password
 * reset token lookup. Every other code path must use the regular `db` client
 * with `withOrgContext(orgId, …)` so RLS enforces tenant isolation.
 *
 * Falls back to DATABASE_URL when DATABASE_URL_ADMIN is unset (e.g. local
 * dev where a single role does everything).
 */
export const bootstrapDb =
  globalThis.prismaBootstrap ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] || '',
      },
    },
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.prismaBootstrap = bootstrapDb;
}

/**
 * Execute a database operation with organization RLS context.
 *
 * In production with RLS enabled, this wraps the operation in a transaction
 * that sets the current organization ID for row-level security policies.
 *
 * IMPORTANT: Always use SET LOCAL (not SET) to scope to the transaction.
 *
 * @param organizationId - The organization ID to use for RLS context
 * @param operation - The database operation to execute
 * @returns The result of the database operation
 *
 * @example
 * const rooms = await withOrgContext(session.organizationId, async (tx) => {
 *   return tx.room.findMany();
 * });
 */
export async function withOrgContext<T>(
  organizationId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  // Skip RLS in development unless explicitly enabled
  const enableRLS =
    process.env['ENABLE_RLS'] === 'true' || process.env['NODE_ENV'] === 'production';

  if (!enableRLS) {
    // In development without RLS, just run the operation directly
    return db.$transaction(async (tx) => {
      return operation(tx);
    });
  }

  // In production, set the RLS context before running queries
  return db.$transaction(async (tx) => {
    // SET LOCAL scopes the setting to this transaction only
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return operation(tx);
  });
}

/**
 * Check if RLS is enabled in the current environment.
 */
export function isRLSEnabled(): boolean {
  return process.env['ENABLE_RLS'] === 'true' || process.env['NODE_ENV'] === 'production';
}

export type { PrismaClient } from '@prisma/client';
