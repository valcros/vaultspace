/**
 * Individual Folder Management API
 *
 * GET    /api/rooms/:roomId/folders/:folderId - Get folder details
 * PATCH  /api/rooms/:roomId/folders/:folderId - Update folder (rename)
 * DELETE /api/rooms/:roomId/folders/:folderId - Delete folder (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getPermissionEngine } from '@/lib/permissions';
import { FolderDepthExceededError, validateFolderMoveDepth } from '@/lib/rooms/folderDepth';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; folderId: string }>;
}

/**
 * GET /api/rooms/:roomId/folders/:folderId
 * Get folder details
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, folderId } = await context.params;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Check view permission
      const permissionEngine = getPermissionEngine();
      const canView = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'view',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canView) {
        return { error: 'Access denied', status: 403 };
      }

      const folder = await tx.folder.findFirst({
        where: {
          id: folderId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          _count: {
            select: {
              children: true,
              documents: true,
            },
          },
        },
      });

      if (!folder) {
        return { error: 'Folder not found', status: 404 };
      }

      return { folder };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ folder: result.folder });
  } catch (error) {
    console.error('[FolderAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get folder' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/folders/:folderId
 *
 * Phase 1 supports rename, move, or rename+move in a single request:
 *   - { name }              -> rename only
 *   - { parentId }          -> move only
 *   - { name, parentId }    -> rename + move
 *
 * `parentId: null` re-parents the folder to the room root.
 * `parentId: undefined` (omitted) leaves the parent untouched.
 *
 * Move is rejected if the destination is the folder itself or one of its
 * descendants, or if the move would push any node beyond the depth cap.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, folderId } = await context.params;

    const body = await request.json();
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasParent = Object.prototype.hasOwnProperty.call(body, 'parentId');
    const { name, parentId } = body as { name?: unknown; parentId?: unknown };

    if (!hasName && !hasParent) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Provide name, parentId, or both',
          },
        },
        { status: 400 }
      );
    }

    let newName: string | null = null;
    if (hasName) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_INPUT', message: 'Folder name is required' } },
          { status: 400 }
        );
      }
      newName = name.trim();
      if (newName.length > 255) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Folder name too long (max 255 characters)',
            },
          },
          { status: 400 }
        );
      }
      if (/[<>:"/\\|?*]/.test(newName)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Folder name contains invalid characters',
            },
          },
          { status: 400 }
        );
      }
    }

    let newParentIdValue: string | null | undefined;
    if (hasParent) {
      if (parentId === null) {
        newParentIdValue = null;
      } else if (typeof parentId === 'string' && parentId) {
        newParentIdValue = parentId;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'parentId must be a string or null' },
          },
          { status: 400 }
        );
      }
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Check admin permission
      const permissionEngine = getPermissionEngine();
      const canAdmin = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'admin',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canAdmin) {
        return { error: 'Admin access required', status: 403 };
      }

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

      const oldPath = folder.path;
      const resolvedName = newName ?? folder.name;

      let destinationParentPath: string | null;
      let destinationParentId: string | null;
      if (newParentIdValue === undefined) {
        // Parent unchanged.
        destinationParentId = folder.parentId;
        if (folder.parentId) {
          const currentParent = await tx.folder.findFirst({
            where: {
              id: folder.parentId,
              roomId,
              organizationId: session.organizationId,
            },
            select: { path: true },
          });
          destinationParentPath = currentParent?.path ?? null;
        } else {
          destinationParentPath = null;
        }
      } else if (newParentIdValue === null) {
        destinationParentId = null;
        destinationParentPath = null;
      } else {
        const destination = await tx.folder.findFirst({
          where: {
            id: newParentIdValue,
            roomId,
            organizationId: session.organizationId,
          },
          select: { id: true, path: true },
        });
        if (!destination) {
          return { error: 'Destination parent folder not found', status: 404 };
        }
        if (destination.id === folder.id) {
          return {
            error: 'Cannot move a folder into itself',
            status: 400,
            code: 'INVALID_INPUT',
          };
        }
        if (destination.path === oldPath || destination.path.startsWith(oldPath + '/')) {
          return {
            error: 'Cannot move a folder into one of its descendants',
            status: 400,
            code: 'INVALID_INPUT',
          };
        }
        destinationParentId = destination.id;
        destinationParentPath = destination.path;
      }

      // Load descendants once; reused for depth check and path rewrites.
      const descendantFolders = await tx.folder.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          path: { startsWith: oldPath + '/' },
        },
      });

      const isMove = newParentIdValue !== undefined && destinationParentId !== folder.parentId;
      if (isMove) {
        try {
          validateFolderMoveDepth(
            oldPath,
            destinationParentPath,
            descendantFolders.map((f) => f.path)
          );
        } catch (depthErr) {
          if (depthErr instanceof FolderDepthExceededError) {
            return {
              depthError: {
                code: depthErr.code,
                message: depthErr.message,
                details: {
                  maxDepth: depthErr.maxDepth,
                  attemptedDepth: depthErr.attemptedDepth,
                  parentFolderId: destinationParentId,
                  operation: depthErr.operation,
                },
              },
            };
          }
          throw depthErr;
        }
      }

      const newPath = destinationParentPath
        ? `${destinationParentPath}/${resolvedName}`
        : `/${resolvedName}`;

      if (newPath !== oldPath) {
        const conflict = await tx.folder.findFirst({
          where: {
            roomId,
            organizationId: session.organizationId,
            path: newPath,
            id: { not: folderId },
          },
        });
        if (conflict) {
          return {
            error: 'A folder with this name already exists at this level',
            status: 409,
          };
        }
      }

      const updated = await tx.folder.update({
        where: { id: folderId },
        data: {
          name: resolvedName,
          path: newPath,
          parentId: destinationParentId,
        },
      });

      if (newPath !== oldPath) {
        for (const child of descendantFolders) {
          await tx.folder.update({
            where: { id: child.id },
            data: {
              path: newPath + child.path.substring(oldPath.length),
            },
          });
        }
      }

      return { folder: updated };
    });

    if ('depthError' in result) {
      return NextResponse.json({ success: false, error: result.depthError }, { status: 400 });
    }

    if ('error' in result) {
      const code = 'code' in result ? result.code : undefined;
      return NextResponse.json(
        {
          success: false,
          error: code ? { code, message: result.error } : { message: result.error },
        },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, folder: result.folder });
  } catch (error) {
    console.error('[FolderAPI] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to update folder' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rooms/:roomId/folders/:folderId
 * Soft delete folder and all contents
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, folderId } = await context.params;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Check delete permission
      const permissionEngine = getPermissionEngine();
      const canDelete = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'delete',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canDelete) {
        return { error: 'Admin access required', status: 403 };
      }

      // Get folder
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

      // Get all descendant folders (by path prefix)
      const descendantFolders = await tx.folder.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          path: { startsWith: folder.path + '/' },
        },
        select: { id: true },
      });

      const folderIds = [folderId, ...descendantFolders.map((f) => f.id)];

      // Soft delete all documents in these folders
      await tx.document.updateMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          folderId: { in: folderIds },
          status: { not: 'DELETED' },
        },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });

      // Delete all folders (hard delete since they're just organizational)
      // Documents are soft-deleted and recoverable
      await tx.folder.deleteMany({
        where: {
          id: { in: folderIds },
          organizationId: session.organizationId,
        },
      });

      return { success: true, deletedFolderCount: folderIds.length };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[FolderAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
