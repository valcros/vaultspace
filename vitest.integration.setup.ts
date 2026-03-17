/**
 * Vitest Integration Test Setup
 *
 * AZURE-ONLY: Tests must run against Azure-hosted services.
 * Local execution is blocked at the config level.
 */

import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { guardIntegrationTests } from '@/lib/azure-guard';

// Enforce Azure-only for integration tests
guardIntegrationTests();

const prisma = new PrismaClient();

// Tables to clean between tests (in order to respect FK constraints)
const TABLES_TO_CLEAN = [
  'Event',
  'SearchIndex',
  'PreviewAsset',
  'FileBlob',
  'DocumentVersion',
  'Document',
  'Folder',
  'LinkVisit',
  'ViewSession',
  'Link',
  'Permission',
  'RoleAssignment',
  'CustomRole',
  'NotificationPreference',
  'Session',
  'Invitation',
  'UserGroup',
  'UserOrganization',
  'User',
  'Room',
  'Organization',
];

beforeAll(async () => {
  // Verify database connection
  try {
    await prisma.$connect();
    console.log('[Integration Setup] Connected to test database');
  } catch (error) {
    console.error('[Integration Setup] Failed to connect to database:', error);
    throw new Error('Integration tests require a running PostgreSQL database');
  }
});

beforeEach(async () => {
  // Clean all tables before each test
  for (const table of TABLES_TO_CLEAN) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    } catch {
      // Table might not exist yet, ignore
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  console.log('[Integration Setup] Disconnected from test database');
});

export { prisma };
