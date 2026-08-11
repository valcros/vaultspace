import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockCookieStore = { getAll: vi.fn() };
const mockSignatureBootstrap = vi.fn();
const mockWithOrgContext = vi.fn();
const mockGetViewerSessionByToken = vi.fn();
const mockRequireViewerSession = vi.fn();
const mockCanAccessDocument = vi.fn();
const mockSignatureFindFirst = vi.fn();
const mockSignatureUpdate = vi.fn();
const mockDocumentFindFirst = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/middleware', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock('@/lib/db', () => ({
  db: {
    signatureRequest: {
      findFirst: (...args: unknown[]) => mockSignatureBootstrap(...args),
    },
  },
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/viewerSession', () => ({
  viewerSessionBaseSelect: {},
  getViewerSessionByToken: (...args: unknown[]) => mockGetViewerSessionByToken(...args),
  requireViewerSession: (...args: unknown[]) => mockRequireViewerSession(...args),
}));

vi.mock('@/lib/permissions/LinkPolicy', () => ({
  canViewerLinkAccessDocument: (...args: unknown[]) => mockCanAccessDocument(...args),
}));

import { PATCH } from './route';

const context = {
  params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1', signatureId: 'sig-1' }),
};

function request() {
  return new NextRequest('http://localhost/api/rooms/room-1/documents/doc-1/signatures/sig-1', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'decline', declineReason: 'Synthetic decline' }),
  });
}

function validViewerSession() {
  return {
    id: 'session-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    visitorEmail: 'signer@example.test',
    link: {
      scope: 'DOCUMENT',
      scopedFolderId: null,
      scopedDocumentId: 'doc-1',
    },
  };
}

describe('viewer link policy on signature actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockCookieStore.getAll.mockReturnValue([
      { name: 'viewer_share-token', value: 'viewer-session-token' },
    ]);
    mockSignatureBootstrap.mockResolvedValue({
      organizationId: 'org-1',
      signerEmail: 'signer@example.test',
    });
    mockGetViewerSessionByToken.mockResolvedValue(validViewerSession());
    mockRequireViewerSession.mockImplementation((_shareToken, session) => ({ session }));
    mockDocumentFindFirst.mockResolvedValue({ id: 'doc-1', folderId: null });
    mockCanAccessDocument.mockResolvedValue(true);
    mockSignatureFindFirst.mockResolvedValue({
      id: 'sig-1',
      signerEmail: 'signer@example.test',
      status: 'PENDING',
      expiresAt: null,
    });
    mockSignatureUpdate.mockResolvedValue({ id: 'sig-1', status: 'DECLINED' });
    mockWithOrgContext.mockImplementation(async (_organizationId, callback) =>
      callback({
        signatureRequest: {
          findFirst: mockSignatureFindFirst,
          update: mockSignatureUpdate,
        },
        document: { findFirst: mockDocumentFindFirst },
      })
    );
  });

  it('rejects a cookie whose central serve policy rejects the session', async () => {
    mockRequireViewerSession.mockReturnValue({
      response: NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 }),
    });

    const response = await PATCH(request(), context);

    expect(response.status).toBe(401);
    expect(mockSignatureUpdate).not.toHaveBeenCalled();
  });

  it('denies a designated signer when the requested document is outside link scope', async () => {
    mockCanAccessDocument.mockResolvedValue(false);

    const response = await PATCH(request(), context);

    expect(response.status).toBe(403);
    expect(mockCanAccessDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopedDocumentId: 'doc-1' }),
      'room-1',
      { id: 'doc-1', folderId: null }
    );
    expect(mockSignatureUpdate).not.toHaveBeenCalled();
  });

  it('allows the designated signer only after central session and scope checks pass', async () => {
    const response = await PATCH(request(), context);

    expect(response.status).toBe(200);
    expect(mockSignatureUpdate).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: expect.objectContaining({ status: 'DECLINED' }),
    });
  });
});
