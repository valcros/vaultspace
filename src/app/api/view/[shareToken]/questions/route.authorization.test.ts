import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithOrgContext = vi.fn();
const mockGetViewerSession = vi.fn();
const mockRequireViewerSession = vi.fn();
const mockScopedDocumentIds = vi.fn();
const mockCanAccessDocument = vi.fn();
const mockQuestionFindMany = vi.fn();
const mockDocumentFindFirst = vi.fn();
const mockQuestionCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/viewerSession', () => ({
  viewerSessionBaseSelect: {},
  getViewerSession: (...args: unknown[]) => mockGetViewerSession(...args),
  requireViewerSession: (...args: unknown[]) => mockRequireViewerSession(...args),
}));

vi.mock('@/lib/permissions/LinkPolicy', () => ({
  getViewerLinkScopedDocumentIds: (...args: unknown[]) => mockScopedDocumentIds(...args),
  canViewerLinkAccessDocument: (...args: unknown[]) => mockCanAccessDocument(...args),
}));

import { GET, POST } from './route';

const context = { params: Promise.resolve({ shareToken: 'share-token' }) };

function viewerSession() {
  return {
    id: 'viewer-session-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    visitorEmail: 'viewer@example.test',
    visitorName: 'Synthetic Viewer',
    link: {
      scope: 'DOCUMENT',
      scopedFolderId: null,
      scopedDocumentId: 'doc-1',
    },
  };
}

describe('viewer Q&A link scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetViewerSession.mockResolvedValue(viewerSession());
    mockRequireViewerSession.mockImplementation((_shareToken, session) => ({ session }));
    mockScopedDocumentIds.mockResolvedValue(new Set(['doc-1']));
    mockQuestionFindMany.mockResolvedValue([]);
    mockDocumentFindFirst.mockResolvedValue({ id: 'doc-1', folderId: null });
    mockCanAccessDocument.mockResolvedValue(true);
    mockQuestionCreate.mockResolvedValue({
      id: 'question-1',
      subject: 'Synthetic question',
      body: 'Synthetic body',
      status: 'OPEN',
      createdAt: new Date('2026-08-11T16:00:00.000Z'),
    });
    mockWithOrgContext.mockImplementation(async (_organizationId, callback) =>
      callback({
        question: { findMany: mockQuestionFindMany, create: mockQuestionCreate },
        document: { findFirst: mockDocumentFindFirst },
        event: { create: vi.fn() },
      })
    );
  });

  it('filters own and public questions to room-level or authorized documents', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/view/share-token/questions'),
      context
    );

    expect(response.status).toBe(200);
    expect(mockQuestionFindMany).toHaveBeenCalledTimes(2);
    for (const [query] of mockQuestionFindMany.mock.calls) {
      expect(query.where).toEqual(
        expect.objectContaining({
          roomId: 'room-1',
          OR: [{ documentId: null }, { documentId: { in: ['doc-1'] } }],
        })
      );
    }
  });

  it('rejects a question tied to a document outside the link scope', async () => {
    mockCanAccessDocument.mockResolvedValue(false);
    const response = await POST(
      new NextRequest('http://localhost/api/view/share-token/questions', {
        method: 'POST',
        body: JSON.stringify({
          subject: 'Synthetic question',
          body: 'Synthetic body',
          documentId: 'doc-outside-scope',
        }),
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(mockCanAccessDocument).toHaveBeenCalled();
    expect(mockQuestionCreate).not.toHaveBeenCalled();
  });

  it('uses the session ID instead of an omitted email filter for anonymous viewers', async () => {
    const anonymousSession = { ...viewerSession(), visitorEmail: null };
    mockGetViewerSession.mockResolvedValue(anonymousSession);

    const response = await GET(
      new NextRequest('http://localhost/api/view/share-token/questions'),
      context
    );

    expect(response.status).toBe(200);
    expect(mockQuestionFindMany.mock.calls[0]?.[0]?.where).toEqual(
      expect.objectContaining({ viewSessionId: 'viewer-session-1' })
    );
    expect(mockQuestionFindMany.mock.calls[0]?.[0]?.where).not.toHaveProperty('askedByEmail');
  });
});
