import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookieStore = {
  get: vi.fn(),
};

const mockInvalidateSession = vi.fn();
const mockClearSessionCookie = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/auth', () => ({
  invalidateSession: (...args: Parameters<typeof mockInvalidateSession>) =>
    mockInvalidateSession(...args),
}));

vi.mock('@/lib/middleware', () => ({
  clearSessionCookie: (...args: Parameters<typeof mockClearSessionCookie>) =>
    mockClearSessionCookie(...args),
}));

import { POST } from './route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: 'session-token' });
    mockInvalidateSession.mockResolvedValue(undefined);
    mockClearSessionCookie.mockResolvedValue(undefined);
  });

  it('invalidates the session via the shared helper and clears the cookie', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInvalidateSession).toHaveBeenCalledWith('session-token');
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);
  });
});
