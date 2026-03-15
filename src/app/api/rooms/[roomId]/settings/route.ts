/**
 * Room Settings API (F130)
 *
 * GET   /api/rooms/:roomId/settings - Get room settings
 * PATCH /api/rooms/:roomId/settings - Update room settings
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

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
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Get room with settings
    const room = await db.room.findFirst({
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
        archivedAt: true,
        closedAt: true,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
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
        archivedAt: room.archivedAt,
        closedAt: room.closedAt,
      },
    });
  } catch (error) {
    console.error('[RoomSettingsAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get room settings' },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      description,
      requiresPassword,
      password,
      requiresEmailVerification,
      allowDownloads,
      defaultExpiryDays,
    } = body;

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Invalid room name' },
        { status: 400 }
      );
    }

    // Validate defaultExpiryDays
    if (defaultExpiryDays !== undefined && defaultExpiryDays !== null) {
      if (typeof defaultExpiryDays !== 'number' || defaultExpiryDays < 1 || defaultExpiryDays > 365) {
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

    // Update room
    const updatedRoom = await db.room.update({
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
        archivedAt: true,
        closedAt: true,
      },
    });

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
        archivedAt: updatedRoom.archivedAt,
        closedAt: updatedRoom.closedAt,
      },
    });
  } catch (error) {
    console.error('[RoomSettingsAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update room settings' },
      { status: 500 }
    );
  }
}
