/**
 * Room Admin Removal API (F039)
 *
 * DELETE /api/rooms/:roomId/admins/:userId - Remove admin from room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; userId: string }>;
}

/**
 * DELETE /api/rooms/:roomId/admins/:userId
 * Remove an admin from the room
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, userId } = await context.params;

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

    // Find the role assignment
    const roleAssignment = await db.roleAssignment.findFirst({
      where: {
        organizationId: session.organizationId,
        userId,
        role: 'ADMIN',
        scopeType: 'ROOM',
        roomId,
      },
    });

    if (!roleAssignment) {
      return NextResponse.json(
        { error: 'User is not a room-level admin' },
        { status: 404 }
      );
    }

    // Cannot remove organization-level admins via this endpoint
    const isOrgAdmin = await db.userOrganization.findFirst({
      where: {
        userId,
        organizationId: session.organizationId,
        role: 'ADMIN',
        isActive: true,
      },
    });

    if (isOrgAdmin) {
      return NextResponse.json(
        { error: 'Cannot remove organization-level admin via room settings' },
        { status: 400 }
      );
    }

    // Delete the role assignment
    await db.roleAssignment.delete({
      where: { id: roleAssignment.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AdminsAPI] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to remove admin' },
      { status: 500 }
    );
  }
}
