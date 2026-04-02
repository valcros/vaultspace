/**
 * Checklist Items API
 *
 * POST /api/rooms/:roomId/checklists/:checklistId/items - Add item to checklist
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

const createItemSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  documentId: z.string().optional(),
  assignedToEmail: z.string().email().optional(),
});

/**
 * POST /api/rooms/:roomId/checklists/:checklistId/items
 * Add an item to a checklist
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, description, isRequired, documentId, assignedToEmail } = parsed.data;

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
      const checklist = await tx.checklist.findFirst({
        where: {
          id: checklistId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!checklist) {
        return { error: 'Checklist not found', status: 404 };
      }

      // Verify document if provided
      if (documentId) {
        const document = await tx.document.findFirst({
          where: {
            id: documentId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!document) {
          return { error: 'Document not found', status: 404 };
        }
      }

      // Determine next sortOrder
      const lastItem = await tx.checklistItem.findFirst({
        where: {
          checklistId,
          organizationId: session.organizationId,
        },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      const nextSortOrder = (lastItem?.sortOrder ?? -1) + 1;

      const item = await tx.checklistItem.create({
        data: {
          organizationId: session.organizationId,
          checklistId,
          name: name.trim(),
          description: description?.trim() ?? null,
          isRequired: isRequired ?? true,
          documentId: documentId ?? null,
          assignedToEmail: assignedToEmail ?? null,
          sortOrder: nextSortOrder,
        },
      });

      return { item };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ item: result.item }, { status: 201 });
  } catch (error) {
    console.error('[ChecklistItemsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to add checklist item' }, { status: 500 });
  }
}
