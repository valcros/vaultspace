import { PrismaClient } from '@prisma/client';

import {
  assertPasswordResetE2eEnvironment,
  PASSWORD_RESET_E2E_MARKER,
} from './password-reset-e2e-guard';

async function main() {
  const { adminDatabaseUrl } = assertPasswordResetE2eEnvironment();
  const db = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl.toString() } } });
  try {
    await db.$connect();
    await db.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS password_reset_e2e_test_marker (marker text PRIMARY KEY)'
    );
    await db.$executeRaw`
      INSERT INTO password_reset_e2e_test_marker (marker)
      VALUES (${PASSWORD_RESET_E2E_MARKER})
      ON CONFLICT (marker) DO NOTHING`;
    console.log('Password-reset browser E2E disposable marker verified');
  } finally {
    await db.$disconnect();
  }
}

void main();
