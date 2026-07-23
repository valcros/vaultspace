import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockWithOrgContext = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

import { GET } from './route';

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Test',
      lastName: 'Admin',
      twoFactorEnabled: false,
    });
    mockWithOrgContext.mockImplementation(
      async (organizationId: string, operation: (tx: unknown) => Promise<unknown>) => {
        expect(organizationId).toBe('org-1');
        return operation({ user: { findUnique: mockUserFindUnique } });
      }
    );
  });

  it('loads the authenticated profile inside the session organization context', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual(
      expect.objectContaining({ id: 'user-1', email: 'admin@example.com' })
    );
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        twoFactorEnabled: true,
      },
    });
  });

  it('does not return a profile when the scoped lookup cannot see the session user', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('does not query for a profile when authentication is missing', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication required' });
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });
});
