import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../errors';

const mockSessionFindMany = vi.fn();
const mockSessionUpdateMany = vi.fn();
const mockCacheDelete = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockResolveSession = vi.fn();
const mockMutationCreate = vi.fn();
const mockMutationRefresh = vi.fn();
const mockMutationInvalidate = vi.fn();

vi.mock('@/lib/db', () => {
  const sessionClient = {
    session: {
      findMany: (...args: unknown[]) => mockSessionFindMany(...args),
      updateMany: (...args: unknown[]) => mockSessionUpdateMany(...args),
    },
  };
  return {
    db: sessionClient,
  };
});

vi.mock('./sessionMutationRepository', () => {
  const methods = {
    createSession: (...args: unknown[]) => mockMutationCreate(...args),
    refreshSession: (...args: unknown[]) => mockMutationRefresh(...args),
    invalidateSession: (...args: unknown[]) => mockMutationInvalidate(...args),
  };
  return {
    SessionMutationRepository: class {
      createSession(...args: unknown[]) {
        return methods.createSession(...args);
      }
      refreshSession(...args: unknown[]) {
        return methods.refreshSession(...args);
      }
      invalidateSession(...args: unknown[]) {
        return methods.invalidateSession(...args);
      }
    },
    sessionMutationRepository: methods,
  };
});

vi.mock('./token', () => ({
  generateSessionToken: () => 't'.repeat(43),
}));

vi.mock('./bootstrapRepository', () => ({
  BootstrapRepository: class {
    resolveSession(token: string) {
      return mockResolveSession(token);
    }
  },
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: {
      delete: mockCacheDelete,
      set: mockCacheSet,
      get: mockCacheGet,
    },
  }),
}));

import {
  clearSessionCache,
  createSession,
  invalidateAllUserSessions,
  invalidateSession,
  validateSession,
} from './session';

describe('auth session invalidation', () => {
  const validSessionToken = 's'.repeat(43);

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationCreate.mockResolvedValue(null);
    mockMutationRefresh.mockResolvedValue(null);
    mockMutationInvalidate.mockResolvedValue(null);
  });

  it('invalidates a single session through the constrained function and clears its cache', async () => {
    mockMutationInvalidate.mockResolvedValue('session-1');
    mockCacheDelete.mockResolvedValue(undefined);

    await invalidateSession(validSessionToken);

    expect(mockMutationInvalidate).toHaveBeenCalledWith(validSessionToken);
    expect(mockSessionFindMany).not.toHaveBeenCalled();
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockCacheDelete).toHaveBeenCalledWith('session:v2:session-1');
  });

  it('creates a session through the constrained function without direct table writes', async () => {
    const createdAt = new Date('2026-08-12T23:10:00.000Z');
    const expiresAt = new Date('2026-08-13T23:10:00.000Z');
    mockMutationCreate.mockResolvedValue({
      sessionId: 'session-1',
      createdAt,
      expiresAt,
    });

    const result = await createSession('user-1', 'org-1', {
      expiresAt,
      ipAddress: '192.0.2.10',
      userAgent: 'unit-test-agent',
    });

    expect(mockMutationCreate).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      token: 't'.repeat(43),
      expiresAt,
      ipAddress: '192.0.2.10',
      userAgent: 'unit-test-agent',
    });
    expect(result).toMatchObject({
      token: 't'.repeat(43),
      session: {
        id: 'session-1',
        userId: 'user-1',
        organizationId: 'org-1',
        createdAt,
        expiresAt,
        isActive: true,
      },
    });
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('fails closed when constrained session creation returns no row', async () => {
    await expect(createSession('user-1', 'org-1')).rejects.toThrow(
      'BOOTSTRAP_SESSION_CREATE_DENIED'
    );
  });

  it('invalidates all user sessions and removes each cached token', async () => {
    mockSessionFindMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }]);
    mockSessionUpdateMany.mockResolvedValue({ count: 2 });
    mockCacheDelete.mockResolvedValue(undefined);

    await invalidateAllUserSessions('user-1');

    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isActive: true },
      select: { id: true },
    });
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { isActive: false },
    });
    expect(mockCacheDelete).toHaveBeenCalledWith('session:v2:session-1');
    expect(mockCacheDelete).toHaveBeenCalledWith('session:v2:session-2');
  });

  it('treats cache cleanup failures as non-fatal once sessions are deactivated', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCacheDelete.mockRejectedValue(new Error('cache unavailable'));

    await expect(clearSessionCache(['session-1'])).resolves.toBeUndefined();
    const log = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
    expect(log).toMatchObject({
      component: 'session-cache',
      outcome: 'partial_failure',
      requestedCount: 1,
      failureCount: 1,
    });
    expect(JSON.stringify(log)).not.toContain('session-1');
  });

  it('does not trust a cached session once the constrained resolver rejects it', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockResolveSession.mockResolvedValue(null);

    await expect(validateSession(validSessionToken)).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });
});

describe('validateSession read-through cache', () => {
  const validSessionToken = 's'.repeat(43);
  const futureDate = () => new Date(Date.now() + 60 * 60 * 1000);
  const recentDate = () => new Date(Date.now() - 60 * 60 * 1000);

  const completeSnapshot = () => ({
    v: 2,
    data: {
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
      },
      organization: {
        id: 'org-1',
        name: 'Org',
        slug: 'org',
        role: 'ADMIN',
        canManageUsers: true,
        canManageRooms: true,
      },
      expiresAt: futureDate().toISOString(),
      issuedAt: recentDate().toISOString(),
    },
  });

  const liveProjection = () => {
    const snapshot = completeSnapshot().data;
    return {
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      organizationId: snapshot.organizationId,
      createdAt: new Date(snapshot.issuedAt),
      expiresAt: new Date(snapshot.expiresAt),
      lastActiveAt: new Date(),
      user: snapshot.user,
      organization: snapshot.organization,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationRefresh.mockResolvedValue(null);
  });

  it('returns a valid cached snapshot only after an exact constrained live resolution', async () => {
    const cached = completeSnapshot();
    const projection = liveProjection();
    projection.expiresAt = new Date(cached.data.expiresAt);
    projection.createdAt = new Date(cached.data.issuedAt);
    mockCacheGet.mockResolvedValue(cached);
    mockResolveSession.mockResolvedValue(projection);

    const result = await validateSession(validSessionToken);

    expect(result.userId).toBe('user-1');
    expect(result.organization.role).toBe('ADMIN');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
    expect(mockCacheGet).toHaveBeenCalledWith('session:v2:session-1');
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('rejects a complete cached snapshot after the constrained resolver reports revocation', async () => {
    mockCacheGet.mockResolvedValue(completeSnapshot());
    mockResolveSession.mockResolvedValue(null);
    mockCacheDelete.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(mockCacheDelete).not.toHaveBeenCalled();
  });

  it('falls through to full DB validation on a version mismatch', async () => {
    const stale = completeSnapshot();
    stale.v = 0;
    mockCacheGet.mockResolvedValue(stale);
    mockResolveSession.mockResolvedValue(liveProjection());
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });

  it('falls through to full DB validation when the cached snapshot is incomplete', async () => {
    const partial = completeSnapshot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (partial.data as any).organization;
    mockCacheGet.mockResolvedValue(partial);
    mockResolveSession.mockResolvedValue(liveProjection());
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });

  it('falls through to the DB path when the cached snapshot is expired', async () => {
    const expired = completeSnapshot();
    expired.data.expiresAt = recentDate().toISOString();
    mockCacheGet.mockResolvedValue(expired);
    mockResolveSession.mockResolvedValue(liveProjection());
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });

  it('falls through to the DB path when the cached user is inactive', async () => {
    const disabled = completeSnapshot();
    disabled.data.user.isActive = false;
    mockCacheGet.mockResolvedValue(disabled);
    mockResolveSession.mockResolvedValue(liveProjection());
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });

  it('validates against the database when the cache read itself fails', async () => {
    mockCacheGet.mockRejectedValue(new Error('redis down'));
    mockResolveSession.mockResolvedValue(liveProjection());
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(mockResolveSession).toHaveBeenCalledWith(validSessionToken);
  });

  it('caches a complete projection after an uncached constrained resolution', async () => {
    const projection = liveProjection();
    mockCacheGet.mockResolvedValue(null);
    mockResolveSession.mockResolvedValue(projection);
    mockCacheSet.mockResolvedValue(undefined);

    await expect(validateSession(validSessionToken)).resolves.toMatchObject({
      sessionId: projection.sessionId,
      userId: projection.userId,
      organizationId: projection.organizationId,
    });
    expect(mockCacheSet).toHaveBeenCalledWith(
      'session:v2:session-1',
      {
        v: 2,
        data: expect.objectContaining({
          sessionId: projection.sessionId,
          userId: projection.userId,
          organizationId: projection.organizationId,
        }),
      },
      60
    );
  });

  it('replaces a cached projection when the live membership projection changes', async () => {
    const cached = completeSnapshot();
    const projection = liveProjection();
    projection.expiresAt = new Date(cached.data.expiresAt);
    projection.createdAt = new Date(cached.data.issuedAt);
    projection.organization = {
      ...projection.organization,
      role: 'VIEWER',
      canManageUsers: false,
    };
    mockCacheGet.mockResolvedValue(cached);
    mockResolveSession.mockResolvedValue(projection);
    mockCacheDelete.mockResolvedValue(undefined);
    mockCacheSet.mockResolvedValue(undefined);

    const result = await validateSession(validSessionToken);

    expect(result.organization.role).toBe('VIEWER');
    expect(mockCacheDelete).toHaveBeenCalledWith('session:v2:session-1');
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it('retains the throttled activity refresh on an old constrained projection', async () => {
    const projection = liveProjection();
    projection.lastActiveAt = new Date(Date.now() - 6 * 60 * 1000);
    mockCacheGet.mockResolvedValue(null);
    mockResolveSession.mockResolvedValue(projection);
    mockCacheSet.mockResolvedValue(undefined);
    mockCacheDelete.mockResolvedValue(undefined);
    mockMutationRefresh.mockResolvedValue({
      sessionId: projection.sessionId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await validateSession(validSessionToken);

    await vi.waitFor(() => {
      expect(mockMutationRefresh).toHaveBeenCalledWith(validSessionToken);
      expect(mockCacheDelete).toHaveBeenCalledWith('session:v2:session-1');
    });
  });
});
