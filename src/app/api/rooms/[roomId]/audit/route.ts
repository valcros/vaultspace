/**
 * Audit Trail API (F025)
 *
 * GET /api/rooms/:roomId/audit - List audit events
 */

import { NextRequest, NextResponse } from 'next/server';
import { EventType } from '@prisma/client';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { csvCell, redactIpAddress } from '@/lib/audit/exportSanitization';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';
const EXPORT_ROW_LIMIT = 10_000;

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
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const parsedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50;
    const eventTypeValue = searchParams.get('eventType');
    const eventType = eventTypeValue as EventType | null;
    const actorId = searchParams.get('actorId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const format = searchParams.get('format');

    if (eventTypeValue && !Object.values(EventType).includes(eventTypeValue as EventType)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }
    if (
      (dateFrom && Number.isNaN(new Date(dateFrom).getTime())) ||
      (dateTo && Number.isNaN(new Date(dateTo).getTime()))
    ) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

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
      const total = await tx.event.count({ where });

      // Get events
      const events = await tx.event.findMany({
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
        const allEvents = await tx.event.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: EXPORT_ROW_LIMIT + 1,
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

        return {
          csv: true,
          allEvents: allEvents.slice(0, EXPORT_ROW_LIMIT),
          roomId,
          exportTruncated: allEvents.length > EXPORT_ROW_LIMIT,
        };
      }

      return { events, total, page, limit };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Handle CSV export
    if ('csv' in result && result.csv) {
      const csvRows = [
        [
          'Timestamp',
          'Event Type',
          'Actor',
          'Actor Email (Asserted when external)',
          'Description',
          'IP Address (Redacted)',
        ]
          .map(csvCell)
          .join(','),
        ...result.allEvents.map((event) => {
          const actorName = event.actor
            ? `${event.actor.firstName} ${event.actor.lastName}`
            : (event.actorEmail ?? 'System');
          return [
            event.createdAt.toISOString(),
            event.eventType,
            actorName,
            event.actor?.email ?? event.actorEmail ?? '',
            event.description ?? '',
            redactIpAddress(event.ipAddress) ?? '',
          ]
            .map(csvCell)
            .join(',');
        }),
      ];

      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit-${result.roomId}-${new Date().toISOString().split('T')[0]}.csv"`,
          'Cache-Control': 'private, no-store',
          'X-Activity-Export-Limit': String(EXPORT_ROW_LIMIT),
          'X-Activity-Export-Truncated': String(result.exportTruncated),
        },
      });
    }

    // At this point, result must be the success case with events, total, page, limit
    // TypeScript needs explicit checks due to union type
    if (!('events' in result) || result.total === undefined || result.limit === undefined) {
      return NextResponse.json({ error: 'Unexpected result format' }, { status: 500 });
    }

    // Map Prisma Event fields to client-expected shape
    // Include both eventType (for audit page) and type (for room activity tab)
    const mappedEvents = result.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      type: event.eventType,
      description: event.description,
      actor: event.actor,
      actorEmail: event.actorEmail,
      identityLabel: event.actor
        ? 'Account identity'
        : event.actorEmail
          ? 'Asserted email'
          : 'System',
      ipAddress: redactIpAddress(event.ipAddress),
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    }));

    return NextResponse.json({
      events: mappedEvents,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[AuditAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list audit events' }, { status: 500 });
  }
}
