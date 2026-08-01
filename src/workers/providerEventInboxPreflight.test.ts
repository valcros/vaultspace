import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('crypto')>()),
  createHash: () => ({
    update: () => ({
      digest: () => 'e63693ca987c4945d08c0aefbcbe6e525b8230345b480aeaa24718af8122283e',
    }),
  }),
}));

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  create: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

function permissionDenied(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('permission denied', {
    code: 'P2010',
    clientVersion: '5.22.0',
    meta: { code: '42501' },
  });
}

function triggerRejected(rule: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`trigger rejected ${rule}`, {
    code: 'P2010',
    clientVersion: '5.22.0',
    meta: { code: 'P0001', message: `ERROR: ${rule}` },
  });
}

vi.mock('@/lib/db', () => ({
  providerIngressDb: {
    $transaction: (...args: unknown[]) => mocks.transaction(...args),
    $disconnect: vi.fn(),
  },
}));

import {
  preflightProviderEventInbox,
  providerInboxPreflightDiagnostic,
} from './providerEventInboxPreflight';

describe('provider event inbox preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockReset();
    mocks.executeRawUnsafe.mockReset();
    process.env['EVENT_GRID_INGRESS_DATABASE_URL'] = 'postgresql://ingress:secret@localhost/db';
    process.env['EVENT_GRID_INBOX_EXPECTED_OWNER'] = 'test';
    process.env['APP_RELEASE'] = 'release-2026.07.31';
    process.env['DEPLOYMENT_MODE'] = 'standalone';
    let stored: Record<string, unknown> | undefined;
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
        {
          protected_function_count: 1,
          exact_function_posture_count: 1,
          exact_trigger_count: 1,
          noninternal_inbox_trigger_count: 1,
          foreign_function_attachment_count: 0,
          function_source: 'reviewed function body',
        },
      ])
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
      .mockImplementation(async () => {
        stored = {
          ...stored,
          processingStatus: 'CONFLICT',
          conflictCount: 1,
          firstConflictAt: new Date('2026-07-31T12:00:00.000Z'),
          conflictingPayloadFingerprint: '4'.repeat(64),
          lastConflictAt: new Date('2026-07-31T12:00:00.000Z'),
          lastConflictingPayloadFingerprint: '4'.repeat(64),
          lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          updatedAt: new Date('2026-07-31T12:00:00.000Z'),
        };
        return [{ conflictCount: 1 }];
      });
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const canonicalTime = new Date('2026-07-31T11:59:00.000Z');
      const result = {
        ...data,
        createdAt: canonicalTime,
        receivedAt: canonicalTime,
        updatedAt: canonicalTime,
        nextProcessingAt: canonicalTime,
        processingStatus: data['processingStatus'] ?? 'PENDING',
        processingAttempts: 0,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        processedAt: null,
        lastErrorCode: data['lastErrorCode'] ?? null,
        quarantineReasonCodes: data['quarantineReasonCodes'] ?? [],
        conflictCount: 0,
        firstConflictAt: null,
        conflictingPayloadFingerprint: null,
        lastConflictAt: null,
        lastConflictingPayloadFingerprint: null,
        deliveryAttemptAt: null,
      };
      if (data['id'] === stored?.['id'] || !stored) {
        stored = result;
      }
      return result;
    });
    mocks.findUniqueOrThrow.mockImplementation(async () => stored);
    mocks.executeRawUnsafe.mockImplementation(async (statement: string) => {
      if (
        statement.startsWith('SELECT 1 FROM') ||
        statement.startsWith('DELETE FROM') ||
        statement.startsWith('CREATE TABLE') ||
        statement.startsWith('CREATE SCHEMA') ||
        statement.startsWith('SELECT public.prevent_provider_event_evidence_change')
      ) {
        throw permissionDenied();
      }
      if (statement.startsWith('INSERT INTO "provider_event_inbox"')) {
        throw triggerRejected('PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID');
      }
      if (statement.includes('"eventType" = \'MUTATED\'')) {
        throw triggerRejected('PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE');
      }
      if (statement.includes('SET "processingStatus" = \'PENDING\'')) {
        throw triggerRejected('PROVIDER_EVENT_CONFLICT_TERMINAL');
      }
      if (statement.startsWith('UPDATE "provider_event_inbox"')) {
        throw triggerRejected('PROVIDER_EVENT_CONFLICT_INTENT_INVALID');
      }
      return 1;
    });
    const tx = {
      $queryRaw: mocks.queryRaw,
      $executeRawUnsafe: mocks.executeRawUnsafe,
      providerEventInbox: {
        create: mocks.create,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
      },
    };
    mocks.transaction.mockImplementation(async (operation) => operation(tx));
  });

  it('proves the exact guard posture, ingress boundary, and rollback canaries', async () => {
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT provider_event_evidence_immutable_check'
    );
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SET "processingStatus" = \'PENDING\'')
    );
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT provider_event_guard_direct_execute_denied'
    );
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledOnce();
    const pendingFingerprint = mocks.create.mock.calls[0]?.[0].data.eventIdFingerprint;
    const quarantineFingerprint = mocks.create.mock.calls[1]?.[0].data.eventIdFingerprint;
    expect(pendingFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(quarantineFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(pendingFingerprint).not.toBe(quarantineFingerprint);
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

    await expect(preflightProviderEventInbox()).rejects.toMatchObject({
      code: 'PROVIDER_INBOX_PREFLIGHT_TENANT_READ_ALLOWED',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('fails closed when a trigger rejection has the wrong reviewed category', async () => {
    mocks.executeRawUnsafe.mockImplementation(async (statement: string) => {
      if (
        statement.startsWith('SELECT 1 FROM') ||
        statement.startsWith('DELETE FROM') ||
        statement.startsWith('CREATE TABLE') ||
        statement.startsWith('CREATE SCHEMA') ||
        statement.startsWith('SELECT public.prevent_provider_event_evidence_change')
      ) {
        throw permissionDenied();
      }
      if (statement.includes('"eventType" = \'MUTATED\'')) {
        throw triggerRejected('PROVIDER_EVENT_CONFLICT_INTENT_INVALID');
      }
      if (statement.startsWith('INSERT INTO "provider_event_inbox"')) {
        throw triggerRejected('PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID');
      }
      if (statement.startsWith('UPDATE "provider_event_inbox"')) {
        throw triggerRejected('PROVIDER_EVENT_CONFLICT_INTENT_INVALID');
      }
      return 1;
    });

    await expect(preflightProviderEventInbox()).rejects.toMatchObject({
      code: 'PROVIDER_INBOX_PREFLIGHT_EVIDENCE_TRIGGER_INVALID',
    });
  });

  it('fails closed when a trigger rejection has the wrong SQLSTATE', async () => {
    mocks.executeRawUnsafe.mockImplementation(async (statement: string) => {
      if (
        statement.startsWith('SELECT 1 FROM') ||
        statement.startsWith('DELETE FROM') ||
        statement.startsWith('CREATE TABLE') ||
        statement.startsWith('CREATE SCHEMA') ||
        statement.startsWith('SELECT public.prevent_provider_event_evidence_change')
      ) {
        throw permissionDenied();
      }
      if (statement.startsWith('INSERT INTO "provider_event_inbox"')) {
        throw triggerRejected('PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID');
      }
      if (statement.includes('"eventType" = \'MUTATED\'')) {
        throw new Prisma.PrismaClientKnownRequestError('constraint rejected mutation', {
          code: 'P2010',
          clientVersion: '5.22.0',
          meta: {
            code: '23514',
            message: 'ERROR: PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE',
          },
        });
      }
      return 1;
    });

    await expect(preflightProviderEventInbox()).rejects.toMatchObject({
      code: 'PROVIDER_INBOX_PREFLIGHT_EVIDENCE_TRIGGER_INVALID',
    });
  });

  it('fails closed when the conflict helper does not return exactly one observation', async () => {
    mocks.queryRaw.mockImplementation(async () => [{ conflictCount: 2 }]);

    await expect(preflightProviderEventInbox()).rejects.toMatchObject({
      code: 'PROVIDER_INBOX_PREFLIGHT_CONFLICT_TRANSITION_INVALID',
    });
  });

  it('fails closed when the transaction wrapper swallows the rollback sentinel', async () => {
    mocks.transaction.mockImplementation(async (operation) => {
      try {
        await operation({
          $queryRaw: mocks.queryRaw,
          $executeRawUnsafe: mocks.executeRawUnsafe,
          providerEventInbox: {
            create: mocks.create,
            findUniqueOrThrow: mocks.findUniqueOrThrow,
          },
        });
      } catch {
        return undefined;
      }
      return undefined;
    });

    await expect(preflightProviderEventInbox()).rejects.toMatchObject({
      code: 'PROVIDER_INBOX_PREFLIGHT_INCOMPLETE',
    });
  });

  it('emits only bounded categorical diagnostics', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:34:56.000Z'));
    try {
      expect(
        providerInboxPreflightDiagnostic('preflight_completed', 'success', 'isolated_ingress')
      ).toEqual({
        component: 'provider-event-inbox',
        event: 'preflight_completed',
        outcome: 'success',
        contractVersion: '2026-07-31.2',
        release: 'release-2026.07.31',
        deploymentMode: 'standalone',
        observedAt: '2026-07-31T12:34:56.000Z',
        effectiveRoleCategory: 'isolated_ingress',
      });
      process.env['APP_RELEASE'] = 'postgresql://ingress:secret@localhost/db';
      expect(
        providerInboxPreflightDiagnostic(
          'preflight_failed',
          'failed',
          'unverified',
          'PROVIDER_INBOX_PREFLIGHT_GUARD_POSTURE_INVALID'
        )
      ).toEqual(
        expect.objectContaining({
          release: 'unknown',
          effectiveRoleCategory: 'unverified',
          errorCode: 'PROVIDER_INBOX_PREFLIGHT_GUARD_POSTURE_INVALID',
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
