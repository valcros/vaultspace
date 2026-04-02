/**
 * Dashboard Stats API
 *
 * GET /api/dashboard - Get aggregate dashboard metrics
 */

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;

    const data = await withOrgContext(orgId, async (tx) => {
      const [
        totalRooms,
        totalDocuments,
        totalMembers,
        storageAgg,
        draftCount,
        activeCount,
        archivedCount,
        closedCount,
        recentEvents,
        topDocs,
      ] = await Promise.all([
        // Total rooms (excluding CLOSED)
        tx.room.count({
          where: { organizationId: orgId, status: { not: 'CLOSED' } },
        }),

        // Total active documents
        tx.document.count({
          where: { organizationId: orgId, status: 'ACTIVE' },
        }),

        // Total active members
        tx.userOrganization.count({
          where: { organizationId: orgId, isActive: true },
        }),

        // Total storage (sum of fileSize from document versions)
        tx.documentVersion.aggregate({
          where: { organizationId: orgId },
          _sum: { fileSize: true },
        }),

        // Room breakdown by status
        tx.room.count({ where: { organizationId: orgId, status: 'DRAFT' } }),
        tx.room.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
        tx.room.count({ where: { organizationId: orgId, status: 'ARCHIVED' } }),
        tx.room.count({ where: { organizationId: orgId, status: 'CLOSED' } }),

        // Recent activity (last 10 events)
        tx.event.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            actor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            room: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),

        // Top 5 most viewed documents
        tx.document.findMany({
          where: {
            organizationId: orgId,
            status: 'ACTIVE',
            viewCount: { gt: 0 },
          },
          orderBy: { viewCount: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            viewCount: true,
            room: {
              select: { name: true },
            },
          },
        }),
      ]);

      return {
        stats: {
          totalRooms,
          totalDocuments,
          totalMembers,
          totalStorage: Number(storageAgg._sum.fileSize ?? 0),
        },
        roomBreakdown: {
          DRAFT: draftCount,
          ACTIVE: activeCount,
          ARCHIVED: archivedCount,
          CLOSED: closedCount,
        },
        recentActivity: recentEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          actorName: event.actor
            ? (event.actor.firstName + ' ' + event.actor.lastName).trim()
            : event.actorEmail || 'System',
          description: event.description,
          roomName: event.room?.name || null,
          createdAt: event.createdAt,
        })),
        topDocuments: topDocs.map((doc) => ({
          documentId: doc.id,
          name: doc.name,
          roomName: doc.room.name,
          viewCount: doc.viewCount,
        })),
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('[DashboardAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get dashboard data' }, { status: 500 });
  }
}
