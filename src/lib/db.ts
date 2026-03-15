/**
 * Prisma Client Singleton
 *
 * This module provides a singleton instance of the Prisma client
 * to prevent multiple connections during development hot reloading.
 */

import { PrismaClient } from '@prisma/client';

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

export type { PrismaClient } from '@prisma/client';
