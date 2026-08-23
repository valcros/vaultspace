/**
 * Room Management API
 *
 * GET    /api/rooms/:roomId - Get room details
 * PATCH  /api/rooms/:roomId - Update room
 * DELETE /api/rooms/:roomId - Close and retain room
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequestContext, requireAuth } from '@/lib/middleware';
import { AppError } from '@/lib/errors';
import { createServiceContext, roomService } from '@/services';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

const roomUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(10_000).nullable().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED']).optional(),
    allowDownloads: z.boolean().optional(),
    allowViewerVersionHistory: z.boolean().optional(),
    defaultExpiryDays: z.number().int().min(1).nullable().optional(),
    requiresPassword: z.boolean().optional(),
    requiresEmailVerification: z.boolean().optional(),
    enableWatermark: z.boolean().optional(),
    watermarkTemplate: z.string().max(500).nullable().optional(),
    requiresNda: z.boolean().optional(),
    ndaContent: z.string().max(10_000).nullable().optional(),
    allDocumentsConfidential: z.boolean().optional(),
    brandColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    brandLogoUrl: z.string().max(10_000).nullable().optional(),
    ipAllowlist: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .strict();

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

    const parsed = roomUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid room update', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const reqContext = getRequestContext(request);
    const room = await roomService.update(
      createServiceContext({
        session,
        requestId: reqContext.requestId,
        ipAddress: reqContext.ipAddress,
        userAgent: reqContext.userAgent,
      }),
      roomId,
      parsed.data
    );

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
