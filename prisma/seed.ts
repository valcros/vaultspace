/**
 * VaultSpace Database Seed Script
 *
 * Seeds the database with demo data including:
 * - Demo organization
 * - Demo users (admin, member)
 * - Series A Funding Room with sample documents
 *
 * Full implementation in Phase 6.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Placeholder - full seed data in Phase 6
  console.log('Seed script initialized. Full implementation pending.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
