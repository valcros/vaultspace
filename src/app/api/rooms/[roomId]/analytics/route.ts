/**
 * Room Analytics API (F121)
 *
 * GET /api/rooms/:roomId/analytics - Get room activity dashboard data
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/analytics
 * Get room activity and analytics data
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get summary statistics
    const [
      totalDocuments,
      totalViews,
      uniqueViewers,
      totalDownloads,
      recentEvents,
      documentStats,
      viewerActivity,
      dailyViews,
    ] = await Promise.all([
      // Total documents
      db.document.count({
        where: {
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
      }),

      // Total views
      db.linkVisit.count({
        where: {
          roomId,
          organizationId: session.organizationId,
        },
      }),

      // Unique viewers (by email)
      db.linkVisit.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          visitorEmail: { not: null },
        },
        select: { visitorEmail: true },
        distinct: ['visitorEmail'],
      }),

      // Total downloads (from events)
      db.event.count({
        where: {
          roomId,
          organizationId: session.organizationId,
          eventType: 'DOCUMENT_DOWNLOADED',
        },
      }),

      // Recent events
      db.event.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          createdAt: { gte: startDate },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          actor: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),

      // Document statistics
      db.document.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          viewCount: true,
          downloadCount: true,
          lastViewedAt: true,
          createdAt: true,
        },
        orderBy: { viewCount: 'desc' },
        take: 10,
      }),

      // Viewer activity
      db.viewSession.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          createdAt: { gte: startDate },
        },
        select: {
          visitorEmail: true,
          visitorName: true,
          totalTimeSpentSeconds: true,
          lastActivityAt: true,
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 10,
      }),

      // Daily view counts for chart
      db.linkVisit.groupBy({
        by: ['createdAt'],
        where: {
          roomId,
          organizationId: session.organizationId,
          createdAt: { gte: startDate },
        },
        _count: true,
      }),
    ]);

    // Process daily views for chart
    const viewsByDay = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateParts = date.toISOString().split('T');
      const dateKey = dateParts[0] ?? '';
      if (dateKey) {
        viewsByDay.set(dateKey, 0);
      }
    }

    dailyViews.forEach((visit) => {
      const dateParts = visit.createdAt.toISOString().split('T');
      const dateKey = dateParts[0] ?? '';
      if (dateKey && viewsByDay.has(dateKey)) {
        viewsByDay.set(dateKey, (viewsByDay.get(dateKey) ?? 0) + visit._count);
      }
    });

    const viewTimeline = Array.from(viewsByDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      summary: {
        totalDocuments,
        totalViews,
        uniqueViewers: uniqueViewers.length,
        totalDownloads,
      },
      topDocuments: documentStats,
      recentViewers: viewerActivity.map((v) => ({
        email: v.visitorEmail,
        name: v.visitorName,
        timeSpent: v.totalTimeSpentSeconds,
        lastActive: v.lastActivityAt,
      })),
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.eventType,
        description: e.description,
        actor: e.actor
          ? `${e.actor.firstName} ${e.actor.lastName}`
          : e.actorEmail ?? 'System',
        createdAt: e.createdAt,
      })),
      viewTimeline,
      period: { days, startDate: startDate.toISOString() },
    });
  } catch (error) {
    console.error('[AnalyticsAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get analytics' },
      { status: 500 }
    );
  }
}
