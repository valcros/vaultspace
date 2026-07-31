import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

function permissionDenied(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('permission denied', {
    code: 'P2010',
    clientVersion: '5.22.0',
    meta: { code: '42501' },
  });
}

function triggerRejected(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('trigger rejected mutation', {
    code: 'P2010',
    clientVersion: '5.22.0',
    meta: { code: 'P0001' },
  });
}

vi.mock('@/lib/db', () => ({
  providerIngressDb: {
    $transaction: (...args: unknown[]) => mocks.transaction(...args),
    $disconnect: vi.fn(),
  },
}));

import { preflightProviderEventInbox } from './providerEventInboxPreflight';

describe('provider event inbox preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockReset();
    mocks.executeRawUnsafe.mockReset();
    process.env['EVENT_GRID_INGRESS_DATABASE_URL'] = 'postgresql://ingress:secret@localhost/db';
    process.env['EVENT_GRID_INBOX_EXPECTED_OWNER'] = 'test';
    mocks.queryRaw
      .mockResolvedValueOnce([
        {
          current_user: 'vaultspace_event_ingress',
          bypasses_rls: false,
          is_superuser: false,
          can_create_role: false,
          can_create_database: false,
          can_replicate: false,
          inherited_roles: [],
          has_schema_usage: true,
          has_schema_create: false,
          has_database_create: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          table_name: 'provider_event_inbox',
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: false,
          can_truncate: false,
          can_references: false,
          can_trigger: false,
        },
        {
          table_name: 'users',
          can_select: false,
          can_insert: false,
          can_update: false,
          can_delete: false,
          can_truncate: false,
          can_references: false,
          can_trigger: false,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ executable_function_count: 0 }])
      .mockResolvedValueOnce([{ table_owner: 'test' }])
      .mockResolvedValueOnce([
        { grantee: 'test', privilege_type: 'SELECT', is_owner: true },
        {
          grantee: 'vaultspace_event_ingress',
          privilege_type: 'SELECT',
          is_owner: false,
        },
        {
          grantee: 'vaultspace_event_ingress',
          privilege_type: 'INSERT',
          is_owner: false,
        },
        {
          grantee: 'vaultspace_event_ingress',
          privilege_type: 'UPDATE',
          is_owner: false,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ conflictCount: 1 }]);
    mocks.create.mockResolvedValue({});
    mocks.executeRawUnsafe.mockImplementation(async (statement: string) => {
      if (
        statement.startsWith('SELECT 1 FROM') ||
        statement.startsWith('DELETE FROM') ||
        statement.startsWith('CREATE TABLE') ||
        statement.startsWith('CREATE SCHEMA')
      ) {
        throw permissionDenied();
      }
      if (statement.startsWith('UPDATE "provider_event_inbox"')) {
        throw triggerRejected();
      }
      return 1;
    });
    const tx = {
      $queryRaw: mocks.queryRaw,
      $executeRawUnsafe: mocks.executeRawUnsafe,
      providerEventInbox: { create: mocks.create, update: mocks.update },
    };
    mocks.transaction.mockImplementation(async (operation) => operation(tx));
  });

  it('verifies least privilege, evidence immutability, and processing transitions', async () => {
    mocks.update.mockImplementationOnce(async ({ data }) => ({
      processingStatus: 'PROCESSING',
      processingLeaseId: data.processingLeaseId,
    }));
    mocks.update.mockResolvedValueOnce({ processingStatus: 'PROCESSED', processedAt: new Date() });

    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT provider_event_evidence_immutable_check'
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'PROCESSED' }),
      })
    );
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SET "processingStatus" = \'PENDING\'')
    );
  });

  it('rejects a role that can access tenant tables', async () => {
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        {
          current_user: 'vaultspace_app',
          bypasses_rls: false,
          is_superuser: false,
          can_create_role: false,
          can_create_database: false,
          can_replicate: false,
          inherited_roles: ['vaultspace_tenant_reader'],
          has_schema_usage: true,
          has_schema_create: false,
          has_database_create: false,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(preflightProviderEventInbox()).rejects.toThrow(/isolated non-superuser/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('fails closed when a negative canary errors for a reason other than permission denial', async () => {
    mocks.executeRawUnsafe.mockImplementation(async (statement: string) => {
      if (statement.startsWith('SELECT 1 FROM')) {
        throw new Prisma.PrismaClientKnownRequestError('relation missing', {
          code: 'P2010',
          clientVersion: '5.22.0',
          meta: { code: '42P01' },
        });
      }
      return 1;
    });

    await expect(preflightProviderEventInbox()).rejects.toThrow(/relation missing/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
