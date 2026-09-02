/**
 * POST /api/rooms/:roomId/folders/starter
 * Apply a selected starter-folder template to an existing independent room.
 * This endpoint creates folders only. It does not copy or expose documents.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { requireMutableRoom } from '@/lib/rooms/roomLifecyclePolicy';
import { createStarterFolderTree } from '@/lib/rooms/createStarterFolderTree';
import {
  getBuiltInRoomTemplate,
  readTemplateFolders,
  resolveStarterFolderSelection,
} from '@/lib/rooms/starterFolderTemplates';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const starterFolderRequestSchema = z.object({
  templateId: z.string().trim().min(1),
  selectedFolderPaths: z.array(z.string()).max(100),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { roomId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'MALFORMED_JSON' },
        { status: 400 }
      );
    }
    const parsed = starterFolderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Template selection or selected folders are invalid' },
        { status: 400 }
      );
    }
    const { templateId, selectedFolderPaths } = parsed.data;
    if (selectedFolderPaths.length === 0) {
      return NextResponse.json({ error: 'Choose at least one starter folder' }, { status: 400 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const roomAccess = await requireMutableRoom(tx, session.organizationId, roomId);
      if (!roomAccess.ok) {
        return roomAccess;
      }

      const builtInTemplate = getBuiltInRoomTemplate(templateId);
      let availableFolders = builtInTemplate?.structure.folders ?? null;
      if (!availableFolders) {
        const template = await tx.roomTemplate.findFirst({
          where: {
            id: templateId,
            OR: [
              { organizationId: session.organizationId },
              { isSystemTemplate: true },
              { isPublic: true },
            ],
          },
        });
        availableFolders = template ? readTemplateFolders(template.folderStructure) : null;
      }
      if (!availableFolders) {
        return {
          ok: false as const,
          status: 404 as const,
          error: 'Selected template was not found',
        };
      }

      const selection = resolveStarterFolderSelection(availableFolders, selectedFolderPaths);
      if (!selection.ok) {
        return { ok: false as const, status: 400 as const, error: selection.error };
      }

      const existing = await tx.folder.findMany({
        where: {
          organizationId: session.organizationId,
          roomId,
          path: { in: selection.folders.map((folder) => folder.path) },
        },
        select: { path: true },
      });
      if (existing.length > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          error: 'One or more selected folders already exist in this room',
        };
      }

      const createdFolderCount = await createStarterFolderTree(tx, {
        organizationId: session.organizationId,
        roomId,
        folders: selection.folders,
      });
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'ROOM_UPDATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          roomId,
          description: `Added ${createdFolderCount} starter folders to room "${roomAccess.room.name}"`,
          metadata: { templateId, starterFolderCount: createdFolderCount },
        },
      });
      return { ok: true as const, createdFolderCount };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...('code' in result ? { code: result.code } : {}) },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { success: true, createdFolderCount: result.createdFolderCount },
      { status: 201 }
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'One or more selected folders already exist in this room' },
        { status: 409 }
      );
    }
    console.error('[StarterFoldersAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to add starter folders' }, { status: 500 });
  }
}
