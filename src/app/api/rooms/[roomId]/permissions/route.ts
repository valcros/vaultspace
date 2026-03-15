/**
 * Room Permissions API (F005, F019)
 *
 * GET    /api/rooms/:roomId/permissions - List permissions
 * POST   /api/rooms/:roomId/permissions - Grant permission
 * DELETE /api/rooms/:roomId/permissions/:permissionId - Revoke permission
 */

import { NextRequest, NextResponse } from 'next/server';
import { PermissionGranteeType, PermissionLevel, PermissionResourceType } from '@prisma/client';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/permissions
 * List all permissions for a room
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

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

    // Get all permissions for the room
    const permissions = await db.permission.findMany({
      where: {
        roomId,
        organizationId: session.organizationId,
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
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('[PermissionsAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list permissions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms/:roomId/permissions
 * Grant permission to user or group
 */
export async function POST(request: NextRequest, context: RouteContext) {
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
      granteeType,
      userId,
      groupId,
      email,
      permissionLevel,
      documentId,
      folderId,
      expiresAt,
    } = body;

    // Validate grantee type
    if (!granteeType || !['USER', 'GROUP'].includes(granteeType)) {
      return NextResponse.json(
        { error: 'Invalid grantee type' },
        { status: 400 }
      );
    }

    // Validate permission level
    const validLevels: PermissionLevel[] = ['VIEW', 'DOWNLOAD', 'ADMIN'];
    if (!permissionLevel || !validLevels.includes(permissionLevel)) {
      return NextResponse.json(
        { error: 'Invalid permission level' },
        { status: 400 }
      );
    }

    let targetUserId = userId;

    // If email is provided, find or validate user
    if (granteeType === 'USER') {
      if (!userId && !email) {
        return NextResponse.json(
          { error: 'User ID or email required' },
          { status: 400 }
        );
      }

      if (email && !userId) {
        // Find user by email
        const user = await db.user.findUnique({
          where: { email },
        });

        if (!user) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }
        targetUserId = user.id;
      }
    }

    // Validate group if granteeType is GROUP
    if (granteeType === 'GROUP') {
      if (!groupId) {
        return NextResponse.json(
          { error: 'Group ID required' },
          { status: 400 }
        );
      }

      const group = await db.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
      });

      if (!group) {
        return NextResponse.json(
          { error: 'Group not found' },
          { status: 404 }
        );
      }
    }

    // Determine resource type
    let resourceType: PermissionResourceType = 'ROOM';
    let targetDocumentId: string | null = null;
    let targetFolderId: string | null = null;

    if (documentId) {
      // Verify document exists in room
      const document = await db.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return NextResponse.json(
          { error: 'Document not found' },
          { status: 404 }
        );
      }
      resourceType = 'DOCUMENT';
      targetDocumentId = documentId;
    } else if (folderId) {
      // Verify folder exists in room
      const folder = await db.folder.findFirst({
        where: {
          id: folderId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!folder) {
        return NextResponse.json(
          { error: 'Folder not found' },
          { status: 404 }
        );
      }
      resourceType = 'FOLDER';
      targetFolderId = folderId;
    }

    // Check for existing permission
    const existingPermission = await db.permission.findFirst({
      where: {
        organizationId: session.organizationId,
        roomId,
        resourceType,
        granteeType: granteeType as PermissionGranteeType,
        userId: targetUserId ?? undefined,
        groupId: groupId ?? undefined,
        documentId: targetDocumentId ?? undefined,
        folderId: targetFolderId ?? undefined,
        isActive: true,
      },
    });

    if (existingPermission) {
      // Update existing permission
      const updated = await db.permission.update({
        where: { id: existingPermission.id },
        data: {
          permissionLevel,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
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

      return NextResponse.json({ permission: updated });
    }

    // Create new permission
    const permission = await db.permission.create({
      data: {
        organizationId: session.organizationId,
        resourceType,
        roomId,
        folderId: targetFolderId,
        documentId: targetDocumentId,
        granteeType: granteeType as PermissionGranteeType,
        userId: targetUserId,
        groupId,
        permissionLevel,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        grantedByUserId: session.userId,
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

    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    console.error('[PermissionsAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to grant permission' },
      { status: 500 }
    );
  }
}
