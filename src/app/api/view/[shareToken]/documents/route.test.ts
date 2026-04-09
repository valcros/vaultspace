import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();

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

import { GET } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

describe('GET /api/view/[shareToken]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCookieStore.get.mockReturnValue({ value: 'viewer-session-token' });
    mockViewSessionFindFirst.mockResolvedValue({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      roomId: 'room-1',
      link: {
        slug: 'share-token',
        scope: 'ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: {
        id: 'room-1',
        name: 'Room Name',
        allowDownloads: true,
        enableWatermark: false,
        watermarkTemplate: null,
        brandColor: '#123456',
        brandLogoUrl: null,
      },
      organization: {
        name: 'Org Name',
        logoUrl: null,
        primaryColor: '#654321',
      },
    });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        document: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      return callback(tx as Parameters<typeof callback>[0]);
    });
  });

  it('accepts the viewer session cookie on the API route and returns documents', async () => {
    const request = new NextRequest('http://localhost:3000/api/view/share-token/documents');

    const response = await GET(request, makeContext('share-token'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCookieStore.get).toHaveBeenCalledWith('viewer_share-token');
    expect(body.session.roomName).toBe('Room Name');
    expect(body.documents).toEqual([]);
  });

  it('rejects revoked viewer sessions', async () => {
    mockViewSessionFindFirst.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/view/share-token/documents');

    const response = await GET(request, makeContext('share-token'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Session expired or invalid');
  });
});
