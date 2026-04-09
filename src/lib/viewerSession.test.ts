import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookieStore = {
  get: vi.fn(),
};

const mockViewSessionFindFirst = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/db', () => ({
  db: {
    viewSession: {
      findFirst: (...args: unknown[]) => mockViewSessionFindFirst(...args),
    },
  },
}));

import { getViewerSession, getViewerSessionGuardResponse } from './viewerSession';

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
    const response = getViewerSessionGuardResponse('share-token', {
      createdAt: new Date(),
      isActive: true,
      link: {
        slug: 'different-token',
        maxSessionMinutes: 30,
      },
    });

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Session expired or invalid' });
  });

  it('rejects sessions that exceed the configured max session age', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-09T12:00:00.000Z');
    vi.setSystemTime(now);

    const response = getViewerSessionGuardResponse('share-token', {
      createdAt: new Date(now.getTime() - 31 * 60 * 1000),
      isActive: true,
      link: {
        slug: 'share-token',
        maxSessionMinutes: 30,
      },
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: 'Session time limit exceeded' });

    vi.useRealTimers();
  });
});
