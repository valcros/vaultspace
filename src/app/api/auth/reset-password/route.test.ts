import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockHash = vi.fn();
const mockFindFirst = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTokenUpdate = vi.fn();
const mockTokenUpdateMany = vi.fn();
const mockTransaction = vi.fn();
const mockInvalidateAllUserSessions = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: Parameters<typeof mockHash>) => mockHash(...args),
  },
}));

vi.mock('@/lib/auth', () => ({
  invalidateAllUserSessions: (...args: Parameters<typeof mockInvalidateAllUserSessions>) =>
    mockInvalidateAllUserSessions(...args),
}));

vi.mock('@/lib/db', () => ({
  db: {
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
  },
}));

import { POST } from './route';

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHash.mockResolvedValue('hashed-password');
    mockFindFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', isActive: true });
    mockUserUpdate.mockReturnValue({ op: 'user.update' });
    mockTokenUpdate.mockReturnValue({ op: 'token.update' });
    mockTokenUpdateMany.mockReturnValue({ op: 'token.updateMany' });
    mockTransaction.mockResolvedValue(undefined);
    mockInvalidateAllUserSessions.mockResolvedValue(undefined);
  });

  it('invalidates all existing sessions after a successful password reset', async () => {
    const request = new NextRequest('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'reset-token', password: 'password123' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAllUserSessions).toHaveBeenCalledWith('user-1');
  });
});
