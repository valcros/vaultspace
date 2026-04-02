/**
 * Calendar Events API
 *
 * GET  /api/rooms/:roomId/calendar - List events for a room
 * POST /api/rooms/:roomId/calendar - Create a calendar event (admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  eventType: z.enum(['MILESTONE', 'REVIEW_DATE', 'DEADLINE', 'MEETING', 'OTHER']).optional(),
  date: z.string().min(1), // ISO date string
  endDate: z.string().optional(),
  isAllDay: z.boolean().optional(),
  color: z.string().max(7).optional(),
  documentId: z.string().nullable().optional(),
});

/**
 * GET /api/rooms/:roomId/calendar
 * List calendar events for a room, ordered by date ascending
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse optional query params
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const type = searchParams.get('type');

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {
        roomId,
        organizationId: session.organizationId,
      };

      // Date range filter
      if (from || to) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dateFilter: any = {};
        if (from) dateFilter.gte = new Date(from);
        if (to) dateFilter.lte = new Date(to);
        where.date = dateFilter;
      }

      // Event type filter
      if (type) {
        where.eventType = type;
      }

      const events = await tx.calendarEvent.findMany({
        where,
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          document: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { date: 'asc' },
      });

      return { events };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ events: result.events });
  } catch (error) {
    console.error('[CalendarAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list calendar events' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/calendar
 * Create a new calendar event (admin)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createEventSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { title, description, eventType, date, endDate, isAllDay, color, documentId } =
      parsed.data;

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

      const calendarEvent = await tx.calendarEvent.create({
        data: {
          organizationId: session.organizationId,
          roomId,
          createdByUserId: session.userId,
          title: title.trim(),
          description: description?.trim() ?? null,
          eventType: eventType ?? 'OTHER',
          date: new Date(date),
          endDate: endDate ? new Date(endDate) : null,
          isAllDay: isAllDay ?? true,
          color: color ?? null,
          documentId: documentId ?? null,
        },
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          document: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return { event: calendarEvent };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ event: result.event }, { status: 201 });
  } catch (error) {
    console.error('[CalendarAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create calendar event' }, { status: 500 });
  }
}
