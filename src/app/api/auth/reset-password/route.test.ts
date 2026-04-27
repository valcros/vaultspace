import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockHash = vi.fn();
const mockFindFirst = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTokenUpdate = vi.fn();
const mockTokenUpdateMany = vi.fn();
const mockTransaction = vi.fn();
const mockDeactivateAllUserSessionsInTx = vi.fn();
const mockClearSessionCache = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: Parameters<typeof mockHash>) => mockHash(...args),
  },
}));

vi.mock('@/lib/auth', () => ({
  clearSessionCache: (...args: Parameters<typeof mockClearSessionCache>) =>
    mockClearSessionCache(...args),
  deactivateAllUserSessionsInTx: (...args: Parameters<typeof mockDeactivateAllUserSessionsInTx>) =>
    mockDeactivateAllUserSessionsInTx(...args),
}));

vi.mock('@/lib/db', () => {
  const client = {
    passwordResetToken: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockTokenUpdate(...args),
      updateMany: (...args: unknown[]) => mockTokenUpdateMany(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    $transaction: (...args: Parameters<typeof mockTransaction>) => mockTransaction(...args),
  };
  return { db: client, bootstrapDb: client };
});

import { POST } from './route';

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHash.mockResolvedValue('hashed-password');
    mockFindFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', isActive: true });
    mockDeactivateAllUserSessionsInTx.mockResolvedValue(['token-1', 'token-2']);
    mockClearSessionCache.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        user: { update: mockUserUpdate.mockResolvedValue(undefined) },
        passwordResetToken: {
          update: mockTokenUpdate.mockResolvedValue(undefined),
          updateMany: mockTokenUpdateMany.mockResolvedValue(undefined),
        },
        session: {
          findMany: vi.fn(),
          updateMany: vi.fn(),
        },
      };

      return callback(tx as Parameters<typeof callback>[0]);
    });
  });

  it('deactivates sessions inside the password reset transaction and clears cache after commit', async () => {
    const request = new NextRequest('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'reset-token', password: 'password123' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDeactivateAllUserSessionsInTx).toHaveBeenCalledWith(expect.any(Object), 'user-1');
    expect(mockClearSessionCache).toHaveBeenCalledWith(['token-1', 'token-2']);
  });
});
