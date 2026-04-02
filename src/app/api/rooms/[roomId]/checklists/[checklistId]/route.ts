/**
 * Single Checklist API
 *
 * GET    /api/rooms/:roomId/checklists/:checklistId - Get checklist with items
 * PATCH  /api/rooms/:roomId/checklists/:checklistId - Update checklist
 * DELETE /api/rooms/:roomId/checklists/:checklistId - Delete checklist
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; checklistId: string }>;
}

const updateChecklistSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
});

/**
 * GET /api/rooms/:roomId/checklists/:checklistId
 * Get a single checklist with all items
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId } = await context.params;

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

      const checklist = await tx.checklist.findFirst({
        where: {
          id: checklistId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              document: {
                select: {
                  id: true,
                  name: true,
                },
              },
              completedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!checklist) {
        return { error: 'Checklist not found', status: 404 };
      }

      return { checklist };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ checklist: result.checklist });
  } catch (error) {
    console.error('[ChecklistAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get checklist' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/checklists/:checklistId
 * Update checklist name/description/isPublic
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateChecklistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, description, isPublic } = parsed.data;

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

      // Verify checklist exists in this room
      const existing = await tx.checklist.findFirst({
        where: {
          id: checklistId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Checklist not found', status: 404 };
      }

      const checklist = await tx.checklist.update({
        where: { id: checklistId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() ?? null }),
          ...(isPublic !== undefined && { isPublic }),
        },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      return { checklist };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ checklist: result.checklist });
  } catch (error) {
    console.error('[ChecklistAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update checklist' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId/checklists/:checklistId
 * Delete checklist and cascade items
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId } = await context.params;

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

      // Verify checklist exists in this room
      const existing = await tx.checklist.findFirst({
        where: {
          id: checklistId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Checklist not found', status: 404 };
      }

      // Delete checklist (items cascade via onDelete: Cascade)
      await tx.checklist.delete({
        where: { id: checklistId },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ChecklistAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete checklist' }, { status: 500 });
  }
}
