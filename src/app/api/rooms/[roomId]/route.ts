/**
 * Room Management API
 *
 * GET    /api/rooms/:roomId - Get room details
 * PATCH  /api/rooms/:roomId - Update room
 * DELETE /api/rooms/:roomId - Close and retain room
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRequestContext, requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { createServiceContext, roomService } from '@/services';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

import type { RoomStatus } from '@prisma/client';

const ROOM_STATUSES: readonly RoomStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED'];

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
    const reqContext = getRequestContext(request);
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });
    const room = await roomService.getById(ctx, roomId);

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
      allowViewerVersionHistory,
      defaultExpiryDays,
      requiresPassword,
      requiresEmailVerification,
      enableWatermark,
      watermarkTemplate,
      requiresNda,
      ndaContent,
      allDocumentsConfidential,
    } = body;

    if (
      status !== undefined &&
      (typeof status !== 'string' || !ROOM_STATUSES.includes(status as RoomStatus))
    ) {
      return NextResponse.json({ error: 'Invalid room status' }, { status: 400 });
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

      // Status is deliberately excluded from generic room updates. The
      // lifecycle service is the only authority for transitions, timestamps,
      // and immutable audit evidence.
      const updateData = {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(allowDownloads !== undefined && { allowDownloads }),
        ...(allowViewerVersionHistory !== undefined && { allowViewerVersionHistory }),
        ...(defaultExpiryDays !== undefined && { defaultExpiryDays }),
        ...(requiresPassword !== undefined && { requiresPassword }),
        ...(requiresEmailVerification !== undefined && { requiresEmailVerification }),
        ...(enableWatermark !== undefined && { enableWatermark }),
        ...(watermarkTemplate !== undefined && { watermarkTemplate }),
        ...(requiresNda !== undefined && { requiresNda }),
        ...(ndaContent !== undefined && { ndaContent }),
        ...(allDocumentsConfidential !== undefined && { allDocumentsConfidential }),
      };

      // A lifecycle-only PATCH must not issue an empty Prisma update before
      // the lifecycle service is called.
      const updatedRoom =
        Object.keys(updateData).length === 0
          ? room
          : await tx.room.update({
              where: { id: roomId },
              data: updateData,
            });

      return { room: updatedRoom };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    let room = result.room;
    if (status !== undefined && status !== result.room.status) {
      const reqContext = getRequestContext(request);
      room = await roomService.changeStatus(
        createServiceContext({
          session,
          requestId: reqContext.requestId,
          ipAddress: reqContext.ipAddress,
          userAgent: reqContext.userAgent,
        }),
        roomId,
        status as RoomStatus
      );
    }

    return NextResponse.json({ room });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('[RoomAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update room' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId
 * Close and retain room
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const reqContext = getRequestContext(request);
    await roomService.changeStatus(
      createServiceContext({
        session,
        requestId: reqContext.requestId,
        ipAddress: reqContext.ipAddress,
        userAgent: reqContext.userAgent,
      }),
      roomId,
      'CLOSED'
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('[RoomAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to close room' }, { status: 500 });
  }
}
