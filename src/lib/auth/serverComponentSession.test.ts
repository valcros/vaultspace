import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookieGet = vi.fn();
const mockResolveSession = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

vi.mock('@/lib/auth/bootstrapRepository', () => ({
  BootstrapRepository: class {
    resolveSession(token: string) {
      return mockResolveSession(token);
    }
  },
}));

import { getServerComponentSession } from './serverComponentSession';

describe('getServerComponentSession constrained resolution', () => {
  const token = 's'.repeat(43);
  const projection = {
    sessionId: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    expiresAt: new Date('2026-08-13T00:00:00.000Z'),
    lastActiveAt: new Date('2026-08-12T01:00:00.000Z'),
    user: {
      id: 'user-1',
      email: 'user@example.test',
      firstName: 'Session',
      lastName: 'User',
      isActive: true,
    },
    organization: {
      id: 'org-1',
      name: 'CloudVault',
      slug: 'cloudvault-w1-2-verify',
      role: 'VIEWER',
      canManageUsers: false,
      canManageRooms: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null without a session cookie and does not query PostgreSQL', async () => {
    mockCookieGet.mockReturnValue(undefined);

    await expect(getServerComponentSession()).resolves.toBeNull();
    expect(mockResolveSession).not.toHaveBeenCalled();
  });

  it('maps the minimal constrained projection to the established shell shape', async () => {
    mockCookieGet.mockReturnValue({ value: token });
    mockResolveSession.mockResolvedValue(projection);

    await expect(getServerComponentSession()).resolves.toEqual({
      id: projection.sessionId,
      userId: projection.userId,
      organizationId: projection.organizationId,
      createdAt: projection.createdAt,
      expiresAt: projection.expiresAt,
      lastActiveAt: projection.lastActiveAt,
      user: projection.user,
      organization: {
        id: projection.organization.id,
        name: projection.organization.name,
        slug: projection.organization.slug,
        isActive: true,
      },
      role: projection.organization.role,
    });
    expect(mockResolveSession).toHaveBeenCalledWith(token);
  });

  it('returns null for a neutral unresolved session', async () => {
    mockCookieGet.mockReturnValue({ value: token });
    mockResolveSession.mockResolvedValue(null);

    await expect(getServerComponentSession()).resolves.toBeNull();
  });

  it('does not hide an operational resolver failure as an authentication denial', async () => {
    mockCookieGet.mockReturnValue({ value: token });
    mockResolveSession.mockRejectedValue(new Error('categorical-test-failure'));

    await expect(getServerComponentSession()).rejects.toThrow('categorical-test-failure');
  });
});
