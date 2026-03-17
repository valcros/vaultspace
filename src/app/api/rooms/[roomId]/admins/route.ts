/**
 * Room Admins API (F039)
 *
 * GET    /api/rooms/:roomId/admins - List room admins
 * POST   /api/rooms/:roomId/admins - Add admin to room
 * DELETE /api/rooms/:roomId/admins/:userId - Remove admin from room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db, withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/admins
 * List all admins for a room
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
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

      // Get room-level admin role assignments
      const roomAdmins = await tx.roleAssignment.findMany({
        where: {
          organizationId: session.organizationId,
          role: 'ADMIN',
          scopeType: 'ROOM',
          roomId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Also get organization-level admins (they have access to all rooms)
      const orgAdmins = await tx.userOrganization.findMany({
        where: {
          organizationId: session.organizationId,
          role: 'ADMIN',
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return { roomAdmins, orgAdmins };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Combine and deduplicate
    const adminMap = new Map<
      string,
      {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        scope: 'organization' | 'room';
      }
    >();

    result.orgAdmins.forEach((oa) => {
      adminMap.set(oa.user.id, {
        ...oa.user,
        scope: 'organization',
      });
    });

    result.roomAdmins.forEach((ra) => {
      if (!adminMap.has(ra.user.id)) {
        adminMap.set(ra.user.id, {
          ...ra.user,
          scope: 'room',
        });
      }
    });

    const admins = Array.from(adminMap.values());

    return NextResponse.json({ admins });
  } catch (error) {
    console.error('[AdminsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list admins' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/admins
 * Add an admin to the room
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
    const { userId, email } = body;

    // Use RLS context for org-scoped queries
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

      let targetUserId = userId;

      // If email provided, find user
      if (!userId && email) {
        const user = await tx.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });

        if (!user) {
          return { error: 'User not found', status: 404 };
        }
        targetUserId = user.id;
      }

      if (!targetUserId) {
        return { error: 'User ID or email required', status: 400 };
      }

      // Verify user is in organization
      const userOrg = await tx.userOrganization.findFirst({
        where: {
          userId: targetUserId,
          organizationId: session.organizationId,
          isActive: true,
        },
      });

      if (!userOrg) {
        return { error: 'User is not a member of this organization', status: 400 };
      }

      // Check if already admin
      const existingRole = await tx.roleAssignment.findFirst({
        where: {
          organizationId: session.organizationId,
          userId: targetUserId,
          role: 'ADMIN',
          scopeType: 'ROOM',
          roomId,
        },
      });

      if (existingRole) {
        return { error: 'User is already an admin of this room', status: 400 };
      }

      // Create room admin role assignment
      const roleAssignment = await tx.roleAssignment.create({
        data: {
          organizationId: session.organizationId,
          userId: targetUserId,
          role: 'ADMIN',
          scopeType: 'ROOM',
          roomId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return { roleAssignment };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        admin: {
          ...result.roleAssignment.user,
          scope: 'room',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[AdminsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to add admin' }, { status: 500 });
  }
}
