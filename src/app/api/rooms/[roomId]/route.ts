/**
 * Room Management API
 *
 * GET    /api/rooms/:roomId - Get room details
 * PATCH  /api/rooms/:roomId - Update room
 * DELETE /api/rooms/:roomId - Soft delete room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db, withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

import type { RoomStatus } from '@prisma/client';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId
 * Get room details
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Use RLS context for org-scoped query
    const room = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        include: {
          _count: {
            select: {
              documents: true,
              folders: true,
              permissions: true,
            },
          },
        },
      });
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    return NextResponse.json({ room });
  } catch (error) {
    console.error('[RoomAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get room' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId
 * Update room (name, description, status, settings)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      status,
      allowDownloads,
      defaultExpiryDays,
      requiresPassword,
      requiresEmailVerification,
    } = body;

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Get current room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Validate status transition (F108)
      if (status && status !== room.status) {
        const validTransitions: Record<RoomStatus, RoomStatus[]> = {
          DRAFT: ['ACTIVE'],
          ACTIVE: ['ARCHIVED', 'CLOSED'],
          ARCHIVED: ['ACTIVE', 'CLOSED'],
          CLOSED: [], // No transitions from CLOSED
        };

        const allowed = validTransitions[room.status] ?? [];
        if (!allowed.includes(status)) {
          return { error: `Cannot transition from ${room.status} to ${status}`, status: 400 };
        }
      }

      // Update room
      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(status && { status }),
          ...(status === 'ARCHIVED' && { archivedAt: new Date() }),
          ...(allowDownloads !== undefined && { allowDownloads }),
          ...(defaultExpiryDays !== undefined && { defaultExpiryDays }),
          ...(requiresPassword !== undefined && { requiresPassword }),
          ...(requiresEmailVerification !== undefined && { requiresEmailVerification }),
        },
      });

      return { room: updatedRoom };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ room: result.room });
  } catch (error) {
    console.error('[RoomAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update room' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId
 * Soft delete (close) room
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Get current room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Soft delete by setting status to CLOSED
      await tx.room.update({
        where: { id: roomId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
        },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[RoomAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete room' }, { status: 500 });
  }
}
