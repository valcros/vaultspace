/**
 * Checklists API (Due Diligence)
 *
 * GET  /api/rooms/:roomId/checklists - List checklists for a room
 * POST /api/rooms/:roomId/checklists - Create a checklist (admin)
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

const createChecklistSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        description: z.string().optional(),
        isRequired: z.boolean().optional(),
      })
    )
    .optional(),
});

/**
 * GET /api/rooms/:roomId/checklists
 * List checklists for a room with items and progress stats
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for all org-scoped queries
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

      const checklists = await tx.checklist.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Compute progress stats
      const checklistsWithStats = checklists.map((checklist) => {
        const itemsCount = checklist.items.length;
        const completedCount = checklist.items.filter((item) => item.status === 'COMPLETE').length;
        return {
          ...checklist,
          _stats: {
            itemsCount,
            completedCount,
          },
        };
      });

      return { checklists: checklistsWithStats };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ checklists: result.checklists });
  } catch (error) {
    console.error('[ChecklistsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list checklists' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/checklists
 * Create a new checklist (admin)
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
    const parsed = createChecklistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, description, isPublic, items } = parsed.data;

    // Use RLS context for all org-scoped queries
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

      // Create the checklist with optional initial items
      const checklist = await tx.checklist.create({
        data: {
          organizationId: session.organizationId,
          roomId,
          name: name.trim(),
          description: description?.trim() ?? null,
          isPublic: isPublic ?? false,
          ...(items && items.length > 0
            ? {
                items: {
                  create: items.map((item, index) => ({
                    organizationId: session.organizationId,
                    name: item.name.trim(),
                    description: item.description?.trim() ?? null,
                    isRequired: item.isRequired ?? true,
                    sortOrder: index,
                  })),
                },
              }
            : {}),
        },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'CHECKLIST_CREATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Checklist created: ${name.trim()}`,
          metadata: {
            checklistId: checklist.id,
            itemCount: items?.length ?? 0,
          },
        },
      });

      return { checklist };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ checklist: result.checklist }, { status: 201 });
  } catch (error) {
    console.error('[ChecklistsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create checklist' }, { status: 500 });
  }
}
