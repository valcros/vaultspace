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
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

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

      // Get all permissions for the room
      const permissions = await tx.permission.findMany({
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

      return { permissions };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ permissions: result.permissions });
  } catch (error) {
    console.error('[PermissionsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list permissions' }, { status: 500 });
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
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
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
      return NextResponse.json({ error: 'Invalid grantee type' }, { status: 400 });
    }

    // Validate permission level
    const validLevels: PermissionLevel[] = ['VIEW', 'DOWNLOAD', 'ADMIN'];
    if (!permissionLevel || !validLevels.includes(permissionLevel)) {
      return NextResponse.json({ error: 'Invalid permission level' }, { status: 400 });
    }

    // Basic validation for USER grantee type
    if (granteeType === 'USER' && !userId && !email) {
      return NextResponse.json({ error: 'User ID or email required' }, { status: 400 });
    }

    // Basic validation for GROUP grantee type
    if (granteeType === 'GROUP' && !groupId) {
      return NextResponse.json({ error: 'Group ID required' }, { status: 400 });
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

      let targetUserId = userId;

      // If email is provided, find or validate user
      if (granteeType === 'USER' && email && !userId) {
        // Find user by email
        const user = await tx.user.findUnique({
          where: { email },
        });

        if (!user) {
          return { error: 'User not found', status: 404 };
        }
        targetUserId = user.id;
      }

      // Validate group if granteeType is GROUP
      if (granteeType === 'GROUP') {
        const group = await tx.group.findFirst({
          where: {
            id: groupId,
            organizationId: session.organizationId,
          },
        });

        if (!group) {
          return { error: 'Group not found', status: 404 };
        }
      }

      // Determine resource type
      let resourceType: PermissionResourceType = 'ROOM';
      let targetDocumentId: string | null = null;
      let targetFolderId: string | null = null;

      if (documentId) {
        // Verify document exists in room
        const document = await tx.document.findFirst({
          where: {
            id: documentId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!document) {
          return { error: 'Document not found', status: 404 };
        }
        resourceType = 'DOCUMENT';
        targetDocumentId = documentId;
      } else if (folderId) {
        // Verify folder exists in room
        const folder = await tx.folder.findFirst({
          where: {
            id: folderId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!folder) {
          return { error: 'Folder not found', status: 404 };
        }
        resourceType = 'FOLDER';
        targetFolderId = folderId;
      }

      // Check for existing permission
      const existingPermission = await tx.permission.findFirst({
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
        const updated = await tx.permission.update({
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

        return { permission: updated, isNew: false };
      }

      // Create new permission
      const permission = await tx.permission.create({
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

      return { permission, isNew: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { permission: result.permission },
      { status: result.isNew ? 201 : 200 }
    );
  } catch (error) {
    console.error('[PermissionsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to grant permission' }, { status: 500 });
  }
}
