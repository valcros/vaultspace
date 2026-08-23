/**
 * Room Settings API (F130)
 *
 * GET   /api/rooms/:roomId/settings - Get room settings
 * PATCH /api/rooms/:roomId/settings - Update room settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { roomUpdateSchema } from '@/lib/rooms/roomUpdateValidation';
import { createServiceContext, roomService } from '@/services';
import type { UpdateRoomOptions } from '@/services';
import { hasCapability } from '@/lib/deployment-capabilities';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

const roomSettingsUpdateSchema = roomUpdateSchema
  .extend({ password: z.string().max(512).nullable().optional() })
  .strict();

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/settings
 * Get room settings
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get room with settings using RLS context
    const room = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          requiresPassword: true,
          requiresEmailVerification: true,
          allowDownloads: true,
          defaultExpiryDays: true,
          requiresNda: true,
          ndaContent: true,
          brandColor: true,
          brandLogoUrl: true,
          enableWatermark: true,
          watermarkTemplate: true,
          ipAllowlist: true,
          archivedAt: true,
          closedAt: true,
        },
      });
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Build security warnings for admin UI
    const securityWarnings: string[] = [];
    if (!hasCapability('canRunVirusScanning')) {
      securityWarnings.push(
        'Virus scanning is not available. Uploaded documents will not be scanned for malware. ' +
          'Configure ClamAV and Redis to enable scanning.'
      );
    }

    return NextResponse.json({
      settings: {
        id: room.id,
        name: room.name,
        description: room.description,
        status: room.status,
        requiresPassword: room.requiresPassword,
        requiresEmailVerification: room.requiresEmailVerification,
        allowDownloads: room.allowDownloads,
        defaultExpiryDays: room.defaultExpiryDays,
        requiresNda: room.requiresNda,
        ndaContent: room.ndaContent,
        brandColor: room.brandColor,
        brandLogoUrl: room.brandLogoUrl,
        enableWatermark: room.enableWatermark,
        watermarkTemplate: room.watermarkTemplate,
        ipAllowlist: room.ipAllowlist,
        archivedAt: room.archivedAt,
        closedAt: room.closedAt,
      },
      // Security posture warnings for admin display
      ...(securityWarnings.length > 0 && { securityWarnings }),
    });
  } catch (error) {
    console.error('[RoomSettingsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get room settings' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/settings
 * Update room settings
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsed = roomSettingsUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid room update', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { password, ...options } = parsed.data;
    const updateOptions: UpdateRoomOptions = { ...options };
    if (password) {
      const bcrypt = await import('bcryptjs');
      updateOptions.passwordHash = await bcrypt.hash(password, 12);
    }

    const reqContext = getRequestContext(request);
    // Use the canonical mutating service so settings, a requested lifecycle
    // transition, timestamps, and audit events commit atomically.
    const updatedRoom = await roomService.update(
      createServiceContext({
        session,
        requestId: reqContext.requestId,
        ipAddress: reqContext.ipAddress,
        userAgent: reqContext.userAgent,
      }),
      roomId,
      updateOptions
    );

    return NextResponse.json({
      settings: {
        id: updatedRoom.id,
        name: updatedRoom.name,
        description: updatedRoom.description,
        status: updatedRoom.status,
        requiresPassword: updatedRoom.requiresPassword,
        requiresEmailVerification: updatedRoom.requiresEmailVerification,
        allowDownloads: updatedRoom.allowDownloads,
        defaultExpiryDays: updatedRoom.defaultExpiryDays,
        requiresNda: updatedRoom.requiresNda,
        ndaContent: updatedRoom.ndaContent,
        brandColor: updatedRoom.brandColor,
        brandLogoUrl: updatedRoom.brandLogoUrl,
        enableWatermark: updatedRoom.enableWatermark,
        watermarkTemplate: updatedRoom.watermarkTemplate,
        ipAllowlist: updatedRoom.ipAllowlist,
        archivedAt: updatedRoom.archivedAt,
        closedAt: updatedRoom.closedAt,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('[RoomSettingsAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update room settings' }, { status: 500 });
  }
}
