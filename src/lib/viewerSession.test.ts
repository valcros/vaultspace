import { describe, expect, it, vi } from 'vitest';

import { getViewerSessionGuardResponse } from './viewerSession';

describe('viewerSession guard', () => {
  it('rejects sessions whose link slug does not match the requested share token', async () => {
    const response = getViewerSessionGuardResponse('share-token', {
      createdAt: new Date(),
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
