/**
 * Rooms API
 *
 * GET  /api/rooms - List rooms
 * POST /api/rooms - Create room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';
import { db, withOrgContext } from '@/lib/db';

/**
 * GET /api/rooms
 * List all rooms for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const where = {
      organizationId: session.organizationId,
      ...(status && { status: status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'CLOSED' }),
      // Non-admins can only see active rooms
      ...(session.organization.role !== 'ADMIN' && { status: 'ACTIVE' as const }),
    };

    // Use RLS context for org-scoped queries
    const [rooms, total] = await withOrgContext(session.organizationId, async (tx) => {
      return Promise.all([
        tx.room.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            _count: {
              select: {
                documents: true,
                folders: true,
              },
            },
          },
        }),
        tx.room.count({ where }),
      ]);
    });

    return NextResponse.json({
      rooms,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rooms.length < total,
      },
    });
  } catch (error) {
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

      // Create template folders if any
      for (const folder of templateFolders) {
        await tx.folder.create({
          data: {
            organizationId: session.organizationId,
            roomId: newRoom.id,
            name: folder.name,
            path: folder.path,
          },
        });
      }

      return newRoom;
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    console.error('[RoomsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
