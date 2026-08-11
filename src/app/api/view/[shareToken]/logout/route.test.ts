import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
const mockViewSessionUpdateMany = vi.fn();
const mockViewSessionDelete = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/db', () => ({
  db: {
    viewSession: {
      findFirst: (...args: unknown[]) => mockViewSessionFindFirst(...args),
    },
  },
  bootstrapDb: {
    viewSession: {
      findFirst: (...args: unknown[]) => mockViewSessionFindFirst(...args),
    },
  },
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

import { POST } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

describe('POST /api/view/[shareToken]/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCookieStore.get.mockReturnValue({ value: 'viewer-session-token' });
    mockViewSessionFindFirst.mockResolvedValue({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      link: {
        slug: 'share-token',
        scope: 'ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
    });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        viewSession: {
          updateMany: mockViewSessionUpdateMany.mockResolvedValue({ count: 1 }),
          delete: mockViewSessionDelete,
        },
      };

      return callback(tx as Parameters<typeof callback>[0]);
    });
  });

  it('clears the viewer cookie and soft-invalidates the exact active session', async () => {
    const request = new NextRequest('http://localhost:3000/api/view/share-token/logout', {
      method: 'POST',
    });

    const response = await POST(request, makeContext('share-token'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockViewSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'view-session-1',
        organizationId: 'org-1',
        isActive: true,
      },
      data: { isActive: false },
    });
    expect(mockViewSessionDelete).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith('viewer_share-token');
  });

  it('remains idempotent when another request already invalidated the session', async () => {
    mockViewSessionUpdateMany.mockResolvedValueOnce({ count: 0 });
    const request = new NextRequest('http://localhost:3000/api/view/share-token/logout', {
      method: 'POST',
    });

    const response = await POST(request, makeContext('share-token'));

    expect(response.status).toBe(200);
    expect(mockViewSessionUpdateMany).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith('viewer_share-token');
  });

  it('clears the requested cookie without a database mutation when no session exists', async () => {
    mockViewSessionFindFirst.mockResolvedValueOnce(null);
    const request = new NextRequest('http://localhost:3000/api/view/share-token/logout', {
      method: 'POST',
    });

    const response = await POST(request, makeContext('share-token'));

    expect(response.status).toBe(200);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockViewSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith('viewer_share-token');
  });

  it('does not invalidate a session bound to a different link', async () => {
    mockViewSessionFindFirst.mockResolvedValueOnce({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      link: {
        slug: 'different-share-token',
        scope: 'ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
    });
    const request = new NextRequest('http://localhost:3000/api/view/share-token/logout', {
      method: 'POST',
    });

    const response = await POST(request, makeContext('share-token'));

    expect(response.status).toBe(200);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockViewSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith('viewer_share-token');
  });
});
