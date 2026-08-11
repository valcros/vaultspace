/**
 * Rooms API
 *
 * GET  /api/rooms - List rooms
 * POST /api/rooms - Create room
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RoomStatus } from '@prisma/client';

import { isAuthenticationError } from '@/lib/errors';
import { getRequestContext, requireAuthFromRequest } from '@/lib/middleware';
import { createServiceContext, roomService } from '@/services';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';
import { withOrgContext } from '@/lib/db';

const ROOM_STATUSES = new Set<RoomStatus>(['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED']);

/**
 * GET /api/rooms
 * List all rooms for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    const { searchParams } = new URL(request.url);
    const requestedStatus = searchParams.get('status');
    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const parsedOffset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    const reqContext = getRequestContext(request);
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });
    const result = await roomService.list(ctx, {
      status:
        requestedStatus && ROOM_STATUSES.has(requestedStatus as RoomStatus)
          ? (requestedStatus as RoomStatus)
          : undefined,
      search: searchParams.get('search') || undefined,
      limit,
      offset,
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
    const { name, description, templateId, allowDownloads, defaultExpiryDays } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 100);

    // If templateId provided, copy structure from template
    let templateFolders: Array<{ name: string; path: string }> = [];

    // Use RLS context for all org-scoped operations
    const room = await withOrgContext(session.organizationId, async (tx) => {
      if (templateId) {
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

        if (template && template.folderStructure) {
          const structure = template.folderStructure as {
            folders?: Array<{ name: string; path: string }>;
          };
          templateFolders = structure.folders ?? [];
        }
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

      // Create template folders in one round trip (template folders are flat;
      // parent relationships are not part of template definitions).
      if (templateFolders.length > 0) {
        await tx.folder.createMany({
          data: templateFolders.map((folder) => ({
            organizationId: session.organizationId,
            roomId: newRoom.id,
            name: folder.name,
            path: folder.path,
          })),
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
          ...(templateId && { metadata: { templateId } }),
        },
      });

      return newRoom;
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[RoomsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
