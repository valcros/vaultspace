import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetViewerSession = vi.fn();
const mockWithOrgContext = vi.fn();
const mockDocumentFindFirst = vi.fn();
const mockFolderFindFirst = vi.fn();
const mockPageViewFindFirst = vi.fn();
const mockPageViewCreate = vi.fn();
const mockPageViewUpdate = vi.fn();

vi.mock('@/lib/viewerSession', () => ({
  viewerSessionBaseSelect: {},
  getViewerSession: (...args: unknown[]) => mockGetViewerSession(...args),
  requireViewerSession: (_shareToken: string, session: unknown) => ({ session }),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

import { POST } from './route';

function makeRequest(body: unknown = { pageNumber: 2, timeSpentMs: 1500 }) {
  return new NextRequest('http://localhost:3000/api/view/share-token/documents/doc-1/page-view', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ shareToken: 'share-token', documentId: 'doc-1' }) };
}

describe('POST /api/view/[shareToken]/documents/[documentId]/page-view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetViewerSession.mockResolvedValue({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      visitorEmail: 'viewer@example.com',
      link: {
        slug: 'share-token',
        isActive: true,
        permission: 'VIEW',
        scope: 'FOLDER',
        scopedFolderId: 'allowed-folder',
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: { id: 'room-1' },
    });
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      folderId: 'allowed-folder',
      currentVersionId: 'version-1',
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });
    mockPageViewFindFirst.mockResolvedValue(null);
    mockPageViewCreate.mockResolvedValue({ id: 'page-view-1' });
    mockPageViewUpdate.mockResolvedValue({ id: 'page-view-1' });
    mockWithOrgContext.mockImplementation(
      async (_organizationId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          document: { findFirst: mockDocumentFindFirst },
          folder: { findFirst: mockFolderFindFirst },
          pageView: {
            findFirst: mockPageViewFindFirst,
            create: mockPageViewCreate,
            update: mockPageViewUpdate,
          },
        })
    );
  });

  it('records a page view for a document inside a room-bound folder scope', async () => {
    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mockFolderFindFirst).toHaveBeenCalledWith({
      where: { id: 'allowed-folder', roomId: 'room-1' },
      select: { parentId: true },
    });
    expect(mockPageViewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-1',
        versionId: 'version-1',
        viewSessionId: 'view-session-1',
        pageNumber: 2,
        timeSpentMs: 1500,
      }),
    });
  });

  it('updates an existing page view for a document in a descendant folder', async () => {
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      folderId: 'child-folder',
      currentVersionId: 'version-1',
    });
    mockFolderFindFirst.mockImplementation(({ where }: { where: { id: string; roomId: string } }) =>
      Promise.resolve(
        where.roomId === 'room-1'
          ? where.id === 'child-folder'
            ? { parentId: 'allowed-folder' }
            : { parentId: null }
          : null
      )
    );
    mockPageViewFindFirst.mockResolvedValue({ id: 'page-view-1' });

    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mockPageViewUpdate).toHaveBeenCalledWith({
      where: { id: 'page-view-1' },
      data: { timeSpentMs: { increment: 1500 } },
    });
    expect(mockPageViewCreate).not.toHaveBeenCalled();
  });

  it('denies an outside-scope document before any page-view read or write', async () => {
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      folderId: 'outside-folder',
      currentVersionId: 'version-1',
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });

    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Document not found' });
    expect(mockPageViewFindFirst).not.toHaveBeenCalled();
    expect(mockPageViewUpdate).not.toHaveBeenCalled();
    expect(mockPageViewCreate).not.toHaveBeenCalled();
  });

  it('returns 404 without analytics writes when the room-scoped document is missing', async () => {
    mockDocumentFindFirst.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(404);
    expect(mockFolderFindFirst).not.toHaveBeenCalled();
    expect(mockPageViewFindFirst).not.toHaveBeenCalled();
    expect(mockPageViewCreate).not.toHaveBeenCalled();
  });
});
