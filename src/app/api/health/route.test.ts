import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  cacheSet: vi.fn(),
  cacheGet: vi.fn(),
  cacheDelete: vi.fn(),
  storageExists: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $queryRaw: mocks.queryRaw },
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: {
      set: mocks.cacheSet,
      get: mocks.cacheGet,
      delete: mocks.cacheDelete,
    },
    storage: { exists: mocks.storageExists },
  }),
}));

import { GET } from './route';

describe('GET /api/health release identity', () => {
  const previousRelease = process.env['NEXT_PUBLIC_APP_RELEASE'];
  const previousRevision = process.env['CONTAINER_APP_REVISION'];
  const previousRedisUrl = process.env['REDIS_URL'];
  const previousRecoveryKeys = process.env['PASSWORD_RESET_RECOVERY_KEYS'];
  const previousActiveKeyId = process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'];
  const previousDatabaseUrl = process.env['DATABASE_URL'];
  const previousSessionSecret = process.env['SESSION_SECRET'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['REDIS_URL'] = 'redis://health-test.invalid:6379';
    mocks.queryRaw.mockResolvedValue([{ ok: 1 }]);
    mocks.cacheSet.mockResolvedValue(undefined);
    mocks.cacheGet.mockResolvedValue('ok');
    mocks.cacheDelete.mockResolvedValue(undefined);
    mocks.storageExists.mockResolvedValue(false);
  });

  afterEach(() => {
    if (previousRelease === undefined) {
      delete process.env['NEXT_PUBLIC_APP_RELEASE'];
    } else {
      process.env['NEXT_PUBLIC_APP_RELEASE'] = previousRelease;
    }

    if (previousRevision === undefined) {
      delete process.env['CONTAINER_APP_REVISION'];
    } else {
      process.env['CONTAINER_APP_REVISION'] = previousRevision;
    }

    for (const [name, value] of [
      ['REDIS_URL', previousRedisUrl],
      ['PASSWORD_RESET_RECOVERY_KEYS', previousRecoveryKeys],
      ['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID', previousActiveKeyId],
      ['DATABASE_URL', previousDatabaseUrl],
      ['SESSION_SECRET', previousSessionSecret],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('exposes the exact release and Container App revision for deployment verification', async () => {
    process.env['NEXT_PUBLIC_APP_RELEASE'] = 'commit-sha-123';
    process.env['CONTAINER_APP_REVISION'] = 'vaultspace-web--revision-123';

    const response = await GET(new NextRequest('https://vaultspace.example.com/api/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({
      release: 'commit-sha-123',
      revision: 'vaultspace-web--revision-123',
      passwordResetRecovery: { deliveryContractVersion: 1 },
    });
    expect(typeof body.passwordResetRecovery.deliveryContractVersion).toBe('number');
  });

  it('exposes the same numeric delivery contract in an uncached deep response without secrets', async () => {
    const recoveryKeySentinel = Buffer.alloc(32, 7).toString('base64');
    const databaseSentinel = 'database-password-sentinel';
    const sessionSentinel = 'session-secret-sentinel';
    process.env['NEXT_PUBLIC_APP_RELEASE'] = 'commit-sha-deep';
    process.env['CONTAINER_APP_REVISION'] = 'vaultspace-web--revision-deep';
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'health-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'health-key': recoveryKeySentinel,
    });
    process.env['DATABASE_URL'] =
      `postgresql://user:${databaseSentinel}@database.invalid/vaultspace`;
    process.env['SESSION_SECRET'] = sessionSentinel;

    const response = await GET(
      new NextRequest('https://vaultspace.example.com/api/health?deep=true')
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({
      release: 'commit-sha-deep',
      revision: 'vaultspace-web--revision-deep',
      passwordResetRecovery: {
        writerVersion: 1,
        deliveryContractVersion: 1,
        configured: true,
        activeKeyId: 'health-key',
      },
      checks: {
        database: { status: 'healthy' },
        cache: { status: 'healthy' },
        storage: { status: 'healthy' },
      },
    });
    expect(typeof body.passwordResetRecovery.deliveryContractVersion).toBe('number');
    expect(serialized).not.toContain(recoveryKeySentinel);
    expect(serialized).not.toContain(databaseSentinel);
    expect(serialized).not.toContain(sessionSentinel);
  });
});
