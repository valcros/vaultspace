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
