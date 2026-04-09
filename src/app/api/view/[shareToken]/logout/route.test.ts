import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
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
          delete: mockViewSessionDelete.mockResolvedValue(undefined),
        },
      };

      return callback(tx as Parameters<typeof callback>[0]);
    });
  });

  it('clears the viewer cookie and deletes the view session', async () => {
    const request = new NextRequest('http://localhost:3000/api/view/share-token/logout', {
      method: 'POST',
    });

    const response = await POST(request, makeContext('share-token'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockViewSessionDelete).toHaveBeenCalledWith({
      where: { id: 'view-session-1' },
    });
    expect(mockCookieStore.delete).toHaveBeenCalledWith('viewer_share-token');
  });
});
