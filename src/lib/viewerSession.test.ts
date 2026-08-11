import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookieStore = {
  get: vi.fn(),
};

const mockViewSessionFindFirst = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    viewSession: {
      findFirst: (...args: unknown[]) => mockViewSessionFindFirst(...args),
    },
  },
}));

import { getViewerSession, getViewerSessionGuardResponse } from './viewerSession';

function makeGuardableSession(
  overrides: {
    linkActive?: boolean;
    linkSlug?: string;
    createdAt?: Date;
    expiresAt?: Date | null;
    maxSessionMinutes?: number | null;
    roomStatus?: string;
  } = {}
) {
  return {
    id: 'viewer-session-1',
    createdAt: overrides.createdAt ?? new Date(),
    isActive: true,
    organizationId: 'org-1',
    roomId: 'room-1',
    linkId: 'link-1',
    link: {
      id: 'link-1',
      slug: overrides.linkSlug ?? 'share-token',
      isActive: overrides.linkActive ?? true,
      organizationId: 'org-1',
      roomId: 'room-1',
      expiresAt: overrides.expiresAt ?? null,
      maxSessionMinutes: overrides.maxSessionMinutes ?? 30,
      permission: 'VIEW' as const,
      scope: 'ENTIRE_ROOM' as const,
      scopedFolderId: null,
      scopedDocumentId: null,
      room: {
        id: 'room-1',
        organizationId: 'org-1',
        status: overrides.roomStatus ?? 'ACTIVE',
      },
    },
  };
}

describe('viewerSession guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only resolves active viewer sessions', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'viewer-session-token' });
    mockViewSessionFindFirst.mockResolvedValue(null);

    await getViewerSession('share-token', {
      id: true,
      isActive: true,
    });

    expect(mockViewSessionFindFirst).toHaveBeenCalledWith({
      where: {
        sessionToken: 'viewer-session-token',
        isActive: true,
      },
      select: {
        id: true,
        isActive: true,
      },
    });
  });

  it('rejects sessions whose link slug does not match the requested share token', async () => {
    const response = getViewerSessionGuardResponse(
      'share-token',
      makeGuardableSession({ linkSlug: 'different-token' })
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Session expired or invalid' });
  });

  it('rejects sessions that exceed the configured max session age', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-09T12:00:00.000Z');
    vi.setSystemTime(now);

    const response = getViewerSessionGuardResponse(
      'share-token',
      makeGuardableSession({
        createdAt: new Date(now.getTime() - 31 * 60 * 1000),
        maxSessionMinutes: 30,
      })
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: 'Session time limit exceeded' });

    vi.useRealTimers();
  });

  it('rejects sessions whose link has been deactivated', async () => {
    const response = getViewerSessionGuardResponse(
      'share-token',
      makeGuardableSession({ linkActive: false })
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Session expired or invalid' });
  });

  it('rejects a session after link expiry even when the session remains active', async () => {
    const response = getViewerSessionGuardResponse(
      'share-token',
      makeGuardableSession({ expiresAt: new Date(Date.now() - 1) })
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Session expired or invalid' });
  });

  it('does not apply maxViews during the serve phase', () => {
    expect(getViewerSessionGuardResponse('share-token', makeGuardableSession())).toBeNull();
  });
});
