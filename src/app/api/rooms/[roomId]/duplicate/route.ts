/**
 * Room Duplication API (F041)
 *
 * POST /api/rooms/:roomId/duplicate - Duplicate a room's structure
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * POST /api/rooms/:roomId/duplicate
 * Create a new room by duplicating an existing room's folder structure.
 * Does NOT copy documents — only the folder tree.
 * The new room starts in DRAFT status.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const newRoom = await withOrgContext(session.organizationId, async (tx) => {
      // Fetch the source room
      const sourceRoom = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!sourceRoom) {
        return null;
      }

      // Generate slug with random suffix for uniqueness
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const newName = `Copy of ${sourceRoom.name}`;
      const slug = newName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 90)
        .concat('-', randomSuffix);

      // Create the new room with same settings
      const duplicatedRoom = await tx.room.create({
        data: {
          organizationId: session.organizationId,
          name: newName,
          slug,
          description: sourceRoom.description,
          status: 'DRAFT',
          allowDownloads: sourceRoom.allowDownloads,
          defaultExpiryDays: sourceRoom.defaultExpiryDays,
          requiresNda: sourceRoom.requiresNda,
          ndaContent: sourceRoom.ndaContent,
          enableWatermark: sourceRoom.enableWatermark,
          watermarkTemplate: sourceRoom.watermarkTemplate,
          requiresPassword: false, // Don't copy password
          requiresEmailVerification: sourceRoom.requiresEmailVerification,
          allDocumentsConfidential: sourceRoom.allDocumentsConfidential,
          createdByUserId: session.userId,
        },
      });

      // Fetch all folders from source room ordered by path (parents before children)
      const sourceFolders = await tx.folder.findMany({
        where: {
          roomId: sourceRoom.id,
          organizationId: session.organizationId,
        },
        orderBy: { path: 'asc' },
      });

      // Recreate folder structure, maintaining parent-child relationships.
      // Batch by depth level: all folders at one depth share resolved parent
      // ids, so each level is a single createMany instead of one round trip
      // per folder. Depth is capped at 3, so this is at most 3 round trips
      // plus one findMany per level to recover generated ids.
      const oldIdToNewId = new Map<string, string>();
      const byDepth = new Map<number, typeof sourceFolders>();
      for (const folder of sourceFolders) {
        const depth = folder.path.split('/').filter(Boolean).length;
        const level = byDepth.get(depth) ?? [];
        level.push(folder);
        byDepth.set(depth, level);
      }

      for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
        const level = byDepth.get(depth)!;
        await tx.folder.createMany({
          data: level.map((folder) => ({
            organizationId: session.organizationId,
            roomId: duplicatedRoom.id,
            name: folder.name,
            path: folder.path,
            parentId: folder.parentId ? (oldIdToNewId.get(folder.parentId) ?? null) : null,
            displayOrder: folder.displayOrder,
            confidential: folder.confidential,
          })),
        });
        const created = await tx.folder.findMany({
          where: {
            organizationId: session.organizationId,
            roomId: duplicatedRoom.id,
            path: { in: level.map((f) => f.path) },
          },
          select: { id: true, path: true },
        });
        const newIdByPath = new Map(created.map((f) => [f.path, f.id]));
        for (const folder of level) {
          const newId = newIdByPath.get(folder.path);
          if (newId) {
            oldIdToNewId.set(folder.id, newId);
          }
        }
      }

      return duplicatedRoom;
    });

    if (!newRoom) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    return NextResponse.json({ room: newRoom }, { status: 201 });
  } catch (error) {
    console.error('[RoomDuplicateAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to duplicate room' }, { status: 500 });
  }
}
