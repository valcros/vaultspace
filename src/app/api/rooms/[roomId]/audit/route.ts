/**
 * Audit Trail API (F025)
 *
 * GET /api/rooms/:roomId/audit - List audit events
 */

import { NextRequest, NextResponse } from 'next/server';
import { EventType } from '@prisma/client';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/audit
 * List audit events for a room
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
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const eventType = searchParams.get('eventType') as EventType | null;
    const actorId = searchParams.get('actorId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const format = searchParams.get('format');

    // Build where clause
    const where = {
      organizationId: session.organizationId,
      roomId,
      ...(eventType && { eventType }),
      ...(actorId && { actorId }),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom && { gte: new Date(dateFrom) }),
              ...(dateTo && { lte: new Date(dateTo) }),
            },
          }
        : {}),
    };

    // Get total count
    const total = await db.event.count({ where });

    // Get events
    const events = await db.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Export as CSV if requested
    if (format === 'csv') {
      const allEvents = await db.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      const csvRows = [
        ['Timestamp', 'Event Type', 'Actor', 'Actor Email', 'Description', 'IP Address'].join(','),
        ...allEvents.map((event) => {
          const actorName = event.actor
            ? `${event.actor.firstName} ${event.actor.lastName}`
            : event.actorEmail ?? 'System';
          return [
            event.createdAt.toISOString(),
            event.eventType,
            `"${actorName}"`,
            event.actor?.email ?? event.actorEmail ?? '',
            `"${(event.description ?? '').replace(/"/g, '""')}"`,
            event.ipAddress ?? '',
          ].join(',');
        }),
      ];

      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit-${roomId}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[AuditAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list audit events' },
      { status: 500 }
    );
  }
}
