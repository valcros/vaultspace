/**
 * Rooms API
 *
 * GET  /api/rooms - List rooms
 * POST /api/rooms - Create room
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RoomStatus } from '@prisma/client';
import { z } from 'zod';

import { isAuthenticationError } from '@/lib/errors';
import { getRequestContext, requireAuthFromRequest } from '@/lib/middleware';
import { createServiceContext, roomService } from '@/services';
import { createStarterFolderTree } from '@/lib/rooms/createStarterFolderTree';
import {
  getBuiltInRoomTemplate,
  readTemplateFolders,
  resolveStarterFolderSelection,
  type StarterFolderDefinition,
} from '@/lib/rooms/starterFolderTemplates';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';
import { withOrgContext } from '@/lib/db';

const ROOM_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED'] as const;
const ROOM_STATUS_SET = new Set<RoomStatus>(ROOM_STATUSES);

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum?: number
): number {
  const parsed = Number.parseInt(typeof value === 'string' ? value : String(fallback), 10);
  const normalized = Number.isFinite(parsed) ? Math.max(parsed, minimum) : fallback;
  return maximum === undefined ? normalized : Math.min(normalized, maximum);
}

const roomListQuerySchema = z.object({
  status: z.preprocess(
    (value) =>
      typeof value === 'string' && ROOM_STATUS_SET.has(value as RoomStatus) ? value : undefined,
    z.enum(ROOM_STATUSES).optional()
  ),
  search: z.preprocess(
    (value) => (typeof value === 'string' && value ? value : undefined),
    z.string().optional()
  ),
  limit: z.preprocess((value) => normalizeInteger(value, 50, 1, 100), z.number().int()),
  offset: z.preprocess((value) => normalizeInteger(value, 0, 0), z.number().int()),
});

/**
 * GET /api/rooms
 * List all rooms for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    const { searchParams } = new URL(request.url);
    const query = roomListQuerySchema.parse({
      status: searchParams.get('status'),
      search: searchParams.get('search'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });
    const reqContext = getRequestContext(request);
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });
    const result = await roomService.list(ctx, {
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json({
      rooms: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[RoomsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list rooms' }, { status: 500 });
  }
}

/**
 * POST /api/rooms
 * Create a new room
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      templateId,
      allowDownloads,
      defaultExpiryDays,
      selectedFolderPaths,
    } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    if (templateId !== undefined && (typeof templateId !== 'string' || !templateId.trim())) {
      return NextResponse.json({ error: 'Template selection is invalid' }, { status: 400 });
    }
    if (
      selectedFolderPaths !== undefined &&
      (!Array.isArray(selectedFolderPaths) ||
        selectedFolderPaths.length > 100 ||
        selectedFolderPaths.some((path) => typeof path !== 'string'))
    ) {
      return NextResponse.json({ error: 'Selected folders are invalid' }, { status: 400 });
    }
    if (selectedFolderPaths !== undefined && !templateId) {
      return NextResponse.json({ error: 'Selected folders require a template' }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 100);

    // If templateId provided, copy structure from template
    let templateFolders: StarterFolderDefinition[] = [];

    // Use RLS context for all org-scoped operations
    const room = await withOrgContext(session.organizationId, async (tx) => {
      if (templateId) {
        const builtInTemplate = getBuiltInRoomTemplate(templateId);
        let availableFolders = builtInTemplate ? builtInTemplate.structure.folders : null;
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
          throw new Error('ROOM_TEMPLATE_NOT_FOUND');
        }
        const selection = resolveStarterFolderSelection(availableFolders, selectedFolderPaths);
        if (!selection.ok) {
          throw new Error(`ROOM_TEMPLATE_INVALID:${selection.error}`);
        }
        templateFolders = selection.folders;
      }

      // Create room
      const newRoom = await tx.room.create({
        data: {
          organizationId: session.organizationId,
          name: name.trim(),
          slug,
          description: description?.trim(),
          status: 'DRAFT',
          allowDownloads: allowDownloads ?? true,
          defaultExpiryDays: defaultExpiryDays,
          createdByUserId: session.userId,
          templateId,
        },
      });

      // Starter templates only create selected, independent room-owned folders.
      // They do not copy documents or share material with another room.
      if (templateFolders.length > 0) {
        await createStarterFolderTree(tx, {
          organizationId: session.organizationId,
          roomId: newRoom.id,
          folders: templateFolders,
        });
      }

      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'ROOM_CREATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId: newRoom.id,
          description: `Created room "${newRoom.name}"`,
          ...(templateId && {
            metadata: { templateId, starterFolderCount: templateFolders.length },
          }),
        },
      });

      return newRoom;
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'ROOM_TEMPLATE_NOT_FOUND') {
      return NextResponse.json({ error: 'Selected template was not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith('ROOM_TEMPLATE_INVALID:')) {
      return NextResponse.json(
        { error: error.message.slice('ROOM_TEMPLATE_INVALID:'.length) },
        { status: 400 }
      );
    }
    console.error('[RoomsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
