import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetViewerSession = vi.fn();
const mockWithOrgContext = vi.fn();
const mockDocumentFindFirst = vi.fn();
const mockDocumentUpdate = vi.fn();
const mockFolderFindFirst = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');

vi.mock('@/lib/viewerSession', () => ({
  viewerSessionBaseSelect: {},
  getViewerSession: (...args: unknown[]) => mockGetViewerSession(...args),
  requireViewerSession: (_shareToken: string, session: unknown) => ({ session }),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { DOCUMENT_VIEWED: 300_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

import { GET } from './route';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/view/share-token/documents/doc-1');
}

function makeContext() {
  return { params: Promise.resolve({ shareToken: 'share-token', documentId: 'doc-1' }) };
}

describe('GET /api/view/[shareToken]/documents/[documentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockGetViewerSession.mockResolvedValue({
      id: 'view-session-1',
      organizationId: 'org-1',
      visitorEmail: 'viewer@example.com',
      visitorName: 'Viewer',
      ipAddress: '127.0.0.1',
      link: {
        permission: 'DOWNLOAD',
        scope: 'ENTIRE_ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
      },
      room: {
        id: 'room-1',
        enableWatermark: false,
        watermarkTemplate: null,
      },
    });
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'Investor update.pdf',
      mimeType: 'application/pdf',
      folderId: null,
      allowDownload: true,
      currentVersionId: 'version-1',
      versions: [{ previewAssets: [{ pageNumber: 1 }] }],
    });
    mockDocumentUpdate.mockResolvedValue({});
    mockFolderFindFirst.mockResolvedValue(null);
    mockWithOrgContext.mockImplementation(
      async (_organizationId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          document: {
            findFirst: mockDocumentFindFirst,
            update: mockDocumentUpdate,
          },
          folder: { findFirst: mockFolderFindFirst },
        })
    );
  });

  it('captures a deduplicated viewer document-open event with asserted-email labeling', async () => {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ viewCount: { increment: 1 } }),
      })
    );
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_VIEWED',
        viewSessionId: 'view-session-1',
        actorEmail: 'viewer@example.com',
        metadata: expect.objectContaining({ identityAssurance: 'ASSERTED_EMAIL' }),
        dedupeWindowMs: 300_000,
        touchViewerActivity: true,
      })
    );
  });

  it('preserves the document response and view counter when audit capture reports failure', async () => {
    mockCaptureAccessAudit.mockResolvedValue('failed');

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mockDocumentUpdate).toHaveBeenCalledTimes(1);
  });

  it('allows a document inside a room-bound folder-scoped link', async () => {
    const session = await mockGetViewerSession();
    mockGetViewerSession.mockResolvedValue({
      ...session,
      link: {
        ...session.link,
        scope: 'FOLDER',
        scopedFolderId: 'allowed-folder',
      },
    });
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'Inside.pdf',
      mimeType: 'application/pdf',
      folderId: 'allowed-folder',
      allowDownload: true,
      currentVersionId: 'version-1',
      versions: [{ previewAssets: [{ pageNumber: 1 }] }],
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mockFolderFindFirst).toHaveBeenCalledWith({
      where: { id: 'allowed-folder', roomId: 'room-1' },
      select: { parentId: true },
    });
    expect(mockDocumentUpdate).toHaveBeenCalledTimes(1);
    expect(mockCaptureAccessAudit).toHaveBeenCalledTimes(1);
  });

  it('denies a document outside a folder-scoped link before counters or audit writes', async () => {
    mockGetViewerSession.mockResolvedValue({
      id: 'view-session-1',
      organizationId: 'org-1',
      visitorEmail: 'viewer@example.com',
      visitorName: 'Viewer',
      ipAddress: '127.0.0.1',
      link: {
        permission: 'DOWNLOAD',
        scope: 'FOLDER',
        scopedFolderId: 'allowed-folder',
        scopedDocumentId: null,
      },
      room: { id: 'room-1', enableWatermark: false, watermarkTemplate: null },
    });
    mockDocumentFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'Outside.pdf',
      mimeType: 'application/pdf',
      folderId: 'outside-folder',
      allowDownload: true,
      currentVersionId: 'version-1',
      versions: [{ previewAssets: [{ pageNumber: 1 }] }],
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(404);
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockCaptureAccessAudit).not.toHaveBeenCalled();
  });
});
