/**
 * Permission Management API (F005)
 *
 * GET    /api/rooms/:roomId/permissions/:permissionId - Get permission details
 * PATCH  /api/rooms/:roomId/permissions/:permissionId - Update permission
 * DELETE /api/rooms/:roomId/permissions/:permissionId - Revoke permission
 */

import { NextRequest, NextResponse } from 'next/server';
import { PermissionLevel } from '@prisma/client';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; permissionId: string }>;
}

/**
 * GET /api/rooms/:roomId/permissions/:permissionId
 * Get details of a specific permission
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, permissionId } = await context.params;

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

      // Get permission
      const permission = await tx.permission.findFirst({
        where: {
          id: permissionId,
          roomId,
          organizationId: session.organizationId,
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
          group: {
            select: {
              id: true,
              name: true,
            },
          },
          grantedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!permission) {
        return { error: 'Permission not found', status: 404 };
      }

      return { permission };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ permission: result.permission });
  } catch (error) {
    console.error('[PermissionAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get permission' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/permissions/:permissionId
 * Update an existing permission
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, permissionId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { permissionLevel, expiresAt } = body;

    // Validate permission level if provided
    if (permissionLevel) {
      const validLevels: PermissionLevel[] = ['VIEW', 'DOWNLOAD', 'ADMIN'];
      if (!validLevels.includes(permissionLevel)) {
        return NextResponse.json({ error: 'Invalid permission level' }, { status: 400 });
      }
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

      // Get existing permission
      const existing = await tx.permission.findFirst({
        where: {
          id: permissionId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Permission not found', status: 404 };
      }

      // Update permission
      const updated = await tx.permission.update({
        where: { id: permissionId },
        data: {
          ...(permissionLevel && { permissionLevel }),
          ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
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
          group: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Log event
      await tx.event.create({
        data: {
          eventType: 'PERMISSION_UPDATED',
          organizationId: session.organizationId,
          actorType: 'ADMIN',
          actorId: session.userId,
          roomId,
          metadata: {
            permissionId,
            permissionLevel: updated.permissionLevel,
            granteeType: updated.granteeType,
            granteeId: updated.userId || updated.groupId,
          },
        },
      });

      return { permission: updated };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ permission: result.permission });
  } catch (error) {
    console.error('[PermissionAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId/permissions/:permissionId
 * Revoke a permission (soft delete by setting isActive = false)
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, permissionId } = await context.params;

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

      // Get existing permission
      const existing = await tx.permission.findFirst({
        where: {
          id: permissionId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          group: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!existing) {
        return { error: 'Permission not found', status: 404 };
      }

      // Soft delete by setting isActive = false
      await tx.permission.update({
        where: { id: permissionId },
        data: { isActive: false },
      });

      // Log event
      await tx.event.create({
        data: {
          eventType: 'PERMISSION_REVOKED',
          organizationId: session.organizationId,
          actorType: 'ADMIN',
          actorId: session.userId,
          roomId,
          metadata: {
            permissionId,
            granteeType: existing.granteeType,
            granteeId: existing.userId || existing.groupId,
            granteeName: existing.user?.email || existing.group?.name,
            permissionLevel: existing.permissionLevel,
          },
        },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[PermissionAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to revoke permission' }, { status: 500 });
  }
}
