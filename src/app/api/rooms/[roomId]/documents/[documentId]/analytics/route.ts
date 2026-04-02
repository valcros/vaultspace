/**
 * Document Page Analytics API (F026)
 *
 * GET /api/rooms/:roomId/documents/:documentId/analytics - Get per-page view analytics
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/analytics
 * Returns per-page view analytics for a document.
 * Aggregates: total views per page, unique viewers per page, avg time per page.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room and document access
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
        select: { id: true, name: true },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Get all page views for this document
      const pageViews = await tx.pageView.findMany({
        where: {
          documentId,
          roomId,
          organizationId: session.organizationId,
        },
        select: {
          pageNumber: true,
          timeSpentMs: true,
          viewerEmail: true,
        },
      });

      // Aggregate by page number
      const pageMap = new Map<
        number,
        { totalViews: number; uniqueViewers: Set<string>; totalTimeMs: number }
      >();

      for (const pv of pageViews) {
        let entry = pageMap.get(pv.pageNumber);
        if (!entry) {
          entry = { totalViews: 0, uniqueViewers: new Set(), totalTimeMs: 0 };
          pageMap.set(pv.pageNumber, entry);
        }
        entry.totalViews += 1;
        if (pv.viewerEmail) {
          entry.uniqueViewers.add(pv.viewerEmail);
        }
        entry.totalTimeMs += pv.timeSpentMs;
      }

      // Convert to sorted array
      const pages = Array.from(pageMap.entries())
        .map(([pageNumber, data]) => ({
          pageNumber,
          totalViews: data.totalViews,
          uniqueViewers: data.uniqueViewers.size,
          avgTimeMs: data.totalViews > 0 ? Math.round(data.totalTimeMs / data.totalViews) : 0,
          totalTimeMs: data.totalTimeMs,
        }))
        .sort((a, b) => a.pageNumber - b.pageNumber);

      return {
        document: { id: document.id, name: document.name },
        pages,
        summary: {
          totalPageViews: pageViews.length,
          uniquePages: pages.length,
          totalViewers: new Set(
            pageViews.filter((pv) => pv.viewerEmail).map((pv) => pv.viewerEmail)
          ).size,
        },
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[DocumentAnalyticsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get document analytics' }, { status: 500 });
  }
}
