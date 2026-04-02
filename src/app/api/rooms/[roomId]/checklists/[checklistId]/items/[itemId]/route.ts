/**
 * Single Checklist Item API
 *
 * PATCH  /api/rooms/:roomId/checklists/:checklistId/items/:itemId - Update item
 * DELETE /api/rooms/:roomId/checklists/:checklistId/items/:itemId - Remove item
 */

import { NextRequest, NextResponse } from 'next/server';
import { ChecklistItemStatus } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; checklistId: string; itemId: string }>;
}

const updateItemSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status: z.nativeEnum(ChecklistItemStatus).optional(),
  isRequired: z.boolean().optional(),
  documentId: z.string().nullable().optional(),
  assignedToEmail: z.string().email().nullable().optional(),
});

/**
 * PATCH /api/rooms/:roomId/checklists/:checklistId/items/:itemId
 * Update a checklist item
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId, itemId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, description, status, isRequired, documentId, assignedToEmail } =
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

      // Verify item exists in this checklist
      const existing = await tx.checklistItem.findFirst({
        where: {
          id: itemId,
          checklistId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Checklist item not found', status: 404 };
      }

      // Verify document if provided
      if (documentId !== undefined && documentId !== null) {
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

      // Determine completion fields
      const isBecomingComplete =
        status === 'COMPLETE' && existing.status !== 'COMPLETE';
      const isLeavingComplete =
        status !== undefined && status !== 'COMPLETE' && existing.status === 'COMPLETE';

      const item = await tx.checklistItem.update({
        where: { id: itemId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && {
            description: description?.trim() ?? null,
          }),
          ...(status !== undefined && { status }),
          ...(isRequired !== undefined && { isRequired }),
          ...(documentId !== undefined && { documentId }),
          ...(assignedToEmail !== undefined && { assignedToEmail }),
          ...(isBecomingComplete && {
            completedAt: new Date(),
            completedByUserId: session.userId,
          }),
          ...(isLeavingComplete && {
            completedAt: null,
            completedByUserId: null,
          }),
        },
      });

      // Create audit event for status changes
      if (status !== undefined && status !== existing.status) {
        const eventType =
          status === 'COMPLETE' ? 'CHECKLIST_ITEM_COMPLETED' : 'CHECKLIST_ITEM_UPDATED';

        await tx.event.create({
          data: {
            organizationId: session.organizationId,
            eventType,
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user.email,
            roomId,
            description: `Checklist item ${status === 'COMPLETE' ? 'completed' : 'updated'}: ${item.name}`,
            metadata: {
              checklistId,
              checklistItemId: item.id,
              previousStatus: existing.status,
              newStatus: status,
            },
          },
        });
      }

      return { item };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ item: result.item });
  } catch (error) {
    console.error('[ChecklistItemAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update checklist item' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rooms/:roomId/checklists/:checklistId/items/:itemId
 * Remove a checklist item
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, checklistId, itemId } = await context.params;

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

      // Verify item exists in this checklist
      const existing = await tx.checklistItem.findFirst({
        where: {
          id: itemId,
          checklistId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Checklist item not found', status: 404 };
      }

      await tx.checklistItem.delete({
        where: { id: itemId },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ChecklistItemAPI] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete checklist item' },
      { status: 500 }
    );
  }
}
