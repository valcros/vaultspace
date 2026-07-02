import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../errors';

const mockSessionFindMany = vi.fn();
const mockSessionUpdateMany = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockCacheDelete = vi.fn();
const mockCacheGet = vi.fn();
const mockSessionUpdate = vi.fn();
const mockUserOrganizationFindUnique = vi.fn();

vi.mock('@/lib/db', () => {
  const sessionClient = {
    session: {
      findMany: (...args: unknown[]) => mockSessionFindMany(...args),
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
      update: (...args: unknown[]) => mockSessionUpdate(...args),
      updateMany: (...args: unknown[]) => mockSessionUpdateMany(...args),
    },
  };
  return {
    db: sessionClient,
    bootstrapDb: sessionClient,
    withOrgContext: vi.fn(async (_orgId, callback) => {
      const tx = {
        userOrganization: {
          findUnique: (...args: unknown[]) => mockUserOrganizationFindUnique(...args),
        },
      };
      return callback(tx as Parameters<typeof callback>[0]);
    }),
  };
});

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: {
      delete: mockCacheDelete,
      set: vi.fn(),
      get: mockCacheGet,
    },
  }),
}));

import {
  clearSessionCache,
  invalidateAllUserSessions,
  invalidateSession,
  validateSession,
} from './session';

describe('auth session invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates a single session in both database and cache', async () => {
    mockSessionFindMany.mockResolvedValue([{ token: 'session-token' }]);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockCacheDelete.mockResolvedValue(undefined);

    await invalidateSession('session-token');

    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { token: 'session-token', isActive: true },
      select: { token: true },
    });
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { token: 'session-token' },
      data: { isActive: false },
    });
    expect(mockCacheDelete).toHaveBeenCalledWith('session:session-token');
  });

  it('invalidates all user sessions and removes each cached token', async () => {
    mockSessionFindMany.mockResolvedValue([{ token: 'token-1' }, { token: 'token-2' }]);
    mockSessionUpdateMany.mockResolvedValue({ count: 2 });
    mockCacheDelete.mockResolvedValue(undefined);

    await invalidateAllUserSessions('user-1');

    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isActive: true },
      select: { token: true },
    });
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { isActive: false },
    });
    expect(mockCacheDelete).toHaveBeenCalledWith('session:token-1');
    expect(mockCacheDelete).toHaveBeenCalledWith('session:token-2');
  });

  it('treats cache cleanup failures as non-fatal once sessions are deactivated', async () => {
    mockCacheDelete.mockRejectedValue(new Error('cache unavailable'));

    await expect(clearSessionCache(['token-1'])).resolves.toBeUndefined();
  });

  it('does not trust stale cached sessions once the database session is inactive', async () => {
    mockCacheGet.mockResolvedValue({
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    mockSessionFindUnique.mockResolvedValue({
      id: 'session-1',
      isActive: false,
    });

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalledWith({
      where: { token: 'session-token' },
      include: {
        user: true,
      },
    });
  });
});

describe('validateSession read-through cache', () => {
  const futureDate = () => new Date(Date.now() + 60 * 60 * 1000);
  const recentDate = () => new Date(Date.now() - 60 * 60 * 1000);

  const completeSnapshot = () => ({
    v: 1,
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid cached snapshot without touching the database', async () => {
    mockCacheGet.mockResolvedValue(completeSnapshot());

    const result = await validateSession('session-token');

    expect(result.userId).toBe('user-1');
    expect(result.organization.role).toBe('ADMIN');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
    expect(mockUserOrganizationFindUnique).not.toHaveBeenCalled();
  });

  it('falls through to full DB validation on a version mismatch', async () => {
    const stale = completeSnapshot();
    stale.v = 0;
    mockCacheGet.mockResolvedValue(stale);
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalled();
  });

  it('falls through to full DB validation when the cached snapshot is incomplete', async () => {
    const partial = completeSnapshot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (partial.data as any).organization;
    mockCacheGet.mockResolvedValue(partial);
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalled();
  });

  it('falls through to the DB path when the cached snapshot is expired', async () => {
    const expired = completeSnapshot();
    expired.data.expiresAt = recentDate().toISOString();
    mockCacheGet.mockResolvedValue(expired);
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalled();
  });

  it('falls through to the DB path when the cached user is inactive', async () => {
    const disabled = completeSnapshot();
    disabled.data.user.isActive = false;
    mockCacheGet.mockResolvedValue(disabled);
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalled();
  });

  it('validates against the database when the cache read itself fails', async () => {
    mockCacheGet.mockRejectedValue(new Error('redis down'));
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(validateSession('session-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockSessionFindUnique).toHaveBeenCalled();
  });
});
