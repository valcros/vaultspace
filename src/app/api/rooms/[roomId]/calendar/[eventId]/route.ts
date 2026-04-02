/**
 * Single Calendar Event API
 *
 * GET    /api/rooms/:roomId/calendar/:eventId - Get event details
 * PATCH  /api/rooms/:roomId/calendar/:eventId - Update event
 * DELETE /api/rooms/:roomId/calendar/:eventId - Delete event
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; eventId: string }>;
}

const updateEventSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  eventType: z.enum(['MILESTONE', 'REVIEW_DATE', 'DEADLINE', 'MEETING', 'OTHER']).optional(),
  date: z.string().optional(),
  endDate: z.string().nullable().optional(),
  isAllDay: z.boolean().optional(),
  color: z.string().max(7).nullable().optional(),
  documentId: z.string().nullable().optional(),
});

/**
 * GET /api/rooms/:roomId/calendar/:eventId
 * Get a single calendar event with relations
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, eventId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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

      const calendarEvent = await tx.calendarEvent.findFirst({
        where: {
          id: eventId,
          roomId,
          organizationId: session.organizationId,
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

      if (!calendarEvent) {
        return { error: 'Event not found', status: 404 };
      }

      return { event: calendarEvent };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ event: result.event });
  } catch (error) {
    console.error('[CalendarAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get calendar event' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/calendar/:eventId
 * Update a calendar event
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, eventId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateEventSchema.safeParse(body);

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

      // Verify event exists in this room
      const existing = await tx.calendarEvent.findFirst({
        where: {
          id: eventId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Event not found', status: 404 };
      }

      const calendarEvent = await tx.calendarEvent.update({
        where: { id: eventId },
        data: {
          ...(title !== undefined && { title: title.trim() }),
          ...(description !== undefined && { description: description?.trim() ?? null }),
          ...(eventType !== undefined && { eventType }),
          ...(date !== undefined && { date: new Date(date) }),
          ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
          ...(isAllDay !== undefined && { isAllDay }),
          ...(color !== undefined && { color }),
          ...(documentId !== undefined && { documentId }),
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

    return NextResponse.json({ event: result.event });
  } catch (error) {
    console.error('[CalendarAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update calendar event' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId/calendar/:eventId
 * Hard delete a calendar event
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, eventId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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

      // Verify event exists in this room
      const existing = await tx.calendarEvent.findFirst({
        where: {
          id: eventId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Event not found', status: 404 };
      }

      await tx.calendarEvent.delete({
        where: { id: eventId },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CalendarAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete calendar event' }, { status: 500 });
  }
}
