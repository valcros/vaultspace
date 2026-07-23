import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

function request() {
  return new NextRequest('http://localhost/api/rooms/room-1/analytics');
}

function context() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('GET /api/rooms/:roomId/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'admin-1',
      organizationId: 'org-1',
      organization: { role: 'ADMIN' },
    } as Awaited<ReturnType<typeof requireAuth>>);
  });

  it('uses operational counters for headline metrics and reports audit reconciliation separately', async () => {
    const eventCount = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    const viewSessionFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ visitorEmail: 'viewer@example.com' }])
      .mockResolvedValueOnce([
        {
          visitorEmail: 'viewer@example.com',
          visitorName: 'Viewer',
          totalTimeSpentSeconds: 60,
          lastActivityAt: new Date('2026-07-23T10:00:00Z'),
        },
      ]);

    mockWithOrgContext.mockImplementation(async (_organizationId, callback) =>
      callback({
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        document: {
          count: vi.fn().mockResolvedValue(3),
          aggregate: vi.fn().mockResolvedValue({
            _sum: { viewCount: 82, downloadCount: 5 },
          }),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'doc-1',
              name: 'Investor update.pdf',
              viewCount: 82,
              downloadCount: 5,
              lastViewedAt: new Date('2026-07-23T09:00:00Z'),
              createdAt: new Date('2026-07-01T09:00:00Z'),
            },
          ]),
        },
        event: {
          count: eventCount,
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'event-1',
              eventType: 'DOCUMENT_VIEWED',
              description: 'Share-link viewer opened a document',
              actorEmail: 'viewer@example.com',
              actor: null,
              metadata: { source: 'native', authoritative: false },
              createdAt: new Date('2026-07-23T10:00:00Z'),
            },
          ]),
        },
        viewSession: { findMany: viewSessionFindMany },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ day: new Date('2026-07-23T00:00:00Z'), views: BigInt(4) }]),
      } as never)
    );

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalDocuments: 3,
      totalViews: 82,
      uniqueViewers: 1,
      totalDownloads: 5,
    });
    expect(body.auditReconciliation).toEqual(
      expect.objectContaining({
        captureMode: 'SHADOW',
        operationalViewCount: 82,
        capturedViewEvents: 4,
        viewDelta: 78,
        operationalDownloadCount: 5,
        capturedDownloadEvents: 2,
        downloadDelta: 3,
      })
    );
    expect(body.recentViewers[0].identityLabel).toBe('Asserted email');
    expect(body.recentEvents[0]).toEqual(
      expect.objectContaining({ identityLabel: 'Asserted email', auditStatus: 'shadow' })
    );
  });

  it('keeps analytics admin-only', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as Awaited<ReturnType<typeof requireAuth>>);

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });
});
