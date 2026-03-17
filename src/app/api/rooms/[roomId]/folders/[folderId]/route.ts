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
 * Update folder (rename)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, folderId } = await context.params;

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    const newName = name.trim();

    // Validate folder name
    if (newName.length > 255) {
      return NextResponse.json({ error: 'Folder name too long (max 255 characters)' }, { status: 400 });
    }

    if (/[<>:"/\\|?*]/.test(newName)) {
      return NextResponse.json({ error: 'Folder name contains invalid characters' }, { status: 400 });
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

      // Get current folder
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

      // Build new path
      const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'));
      const newPath = parentPath ? `${parentPath}/${newName}` : `/${newName}`;

      // Check for duplicate at same level
      const existing = await tx.folder.findFirst({
        where: {
          roomId,
          organizationId: session.organizationId,
          path: newPath,
          id: { not: folderId },
        },
      });

      if (existing) {
        return { error: 'A folder with this name already exists at this level', status: 409 };
      }

      // Update folder and all child paths
      const oldPath = folder.path;

      // Update this folder
      const updated = await tx.folder.update({
        where: { id: folderId },
        data: {
          name: newName,
          path: newPath,
        },
      });

      // Update all child folder paths
      const childFolders = await tx.folder.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          path: { startsWith: oldPath + '/' },
        },
      });

      for (const child of childFolders) {
        await tx.folder.update({
          where: { id: child.id },
          data: {
            path: child.path.replace(oldPath, newPath),
          },
        });
      }

      return { folder: updated };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ folder: result.folder });
  } catch (error) {
    console.error('[FolderAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update folder' }, { status: 500 });
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

      const folderIds = [folderId, ...descendantFolders.map(f => f.id)];

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
