/**
 * Room Settings API (F130)
 *
 * GET   /api/rooms/:roomId/settings - Get room settings
 * PATCH /api/rooms/:roomId/settings - Update room settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { RoomStatus } from '@prisma/client';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { createServiceContext, roomService } from '@/services';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

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

    // Verify room access using RLS context
    const room = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      description,
      status,
      requiresPassword,
      password,
      requiresEmailVerification,
      allowDownloads,
      defaultExpiryDays,
      requiresNda,
      ndaContent,
      brandColor,
      brandLogoUrl,
      enableWatermark,
      watermarkTemplate,
      ipAllowlist,
    } = body;

    // Validate status if provided
    const VALID_STATUSES: string[] = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED'];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json({ error: 'Invalid room name' }, { status: 400 });
    }

    // Validate defaultExpiryDays
    if (defaultExpiryDays !== undefined && defaultExpiryDays !== null) {
      if (
        typeof defaultExpiryDays !== 'number' ||
        defaultExpiryDays < 1 ||
        defaultExpiryDays > 365
      ) {
        return NextResponse.json(
          { error: 'Default expiry must be between 1 and 365 days' },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      updateData['name'] = name.trim();
    }
    if (description !== undefined) {
      updateData['description'] = description?.trim() || null;
    }
    if (requiresPassword !== undefined) {
      updateData['requiresPassword'] = Boolean(requiresPassword);
    }
    if (password !== undefined && password !== null && password !== '') {
      // Hash the password
      const bcrypt = await import('bcryptjs');
      updateData['passwordHash'] = await bcrypt.hash(password, 12);
    }
    if (requiresEmailVerification !== undefined) {
      updateData['requiresEmailVerification'] = Boolean(requiresEmailVerification);
    }
    if (allowDownloads !== undefined) {
      updateData['allowDownloads'] = Boolean(allowDownloads);
    }
    if (defaultExpiryDays !== undefined) {
      updateData['defaultExpiryDays'] = defaultExpiryDays;
    }
    if (requiresNda !== undefined) {
      updateData['requiresNda'] = Boolean(requiresNda);
    }
    if (ndaContent !== undefined) {
      updateData['ndaContent'] = ndaContent?.trim() || null;
    }
    if (brandColor !== undefined) {
      updateData['brandColor'] = brandColor?.trim() || null;
    }
    if (brandLogoUrl !== undefined) {
      updateData['brandLogoUrl'] = brandLogoUrl?.trim() || null;
    }
    if (enableWatermark !== undefined) {
      updateData['enableWatermark'] = Boolean(enableWatermark);
    }
    if (watermarkTemplate !== undefined) {
      updateData['watermarkTemplate'] = watermarkTemplate?.trim() || null;
    }
    if (ipAllowlist !== undefined) {
      if (!Array.isArray(ipAllowlist)) {
        return NextResponse.json(
          { error: 'ipAllowlist must be an array of strings' },
          { status: 400 }
        );
      }
      // Filter out empty strings and trim whitespace
      updateData['ipAllowlist'] = ipAllowlist
        .map((ip: string) => (typeof ip === 'string' ? ip.trim() : ''))
        .filter((ip: string) => ip.length > 0);
    }

    // Update room settings using RLS context
    let updatedRoom = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.update({
        where: { id: roomId },
        data: updateData,
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

    // Handle status change separately via RoomService (manages state machine + events)
    if (status !== undefined && status !== room.status) {
      const reqContext = getRequestContext(request);
      const ctx = createServiceContext({
        session,
        requestId: reqContext.requestId,
        ipAddress: reqContext.ipAddress,
        userAgent: reqContext.userAgent,
      });
      const statusUpdatedRoom = await roomService.changeStatus(ctx, roomId, status as RoomStatus);
      // Merge the status-related fields from the changeStatus result
      updatedRoom = {
        ...updatedRoom,
        status: statusUpdatedRoom.status,
        archivedAt: statusUpdatedRoom.archivedAt,
        closedAt: statusUpdatedRoom.closedAt,
      };
    }

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
    console.error('[RoomSettingsAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update room settings' }, { status: 500 });
  }
}
