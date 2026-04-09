import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSessionFindMany = vi.fn();
const mockSessionUpdateMany = vi.fn();
const mockCacheDelete = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    session: {
      findMany: (...args: unknown[]) => mockSessionFindMany(...args),
      updateMany: (...args: unknown[]) => mockSessionUpdateMany(...args),
    },
  },
  withOrgContext: vi.fn(),
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: {
      delete: mockCacheDelete,
      set: vi.fn(),
      get: vi.fn(),
    },
  }),
}));

import { invalidateAllUserSessions, invalidateSession } from './session';

describe('auth session invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates a single session in both database and cache', async () => {
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockCacheDelete.mockResolvedValue(undefined);

    await invalidateSession('session-token');

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
});
