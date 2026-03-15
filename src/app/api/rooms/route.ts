/**
 * Rooms API
 *
 * GET  /api/rooms - List rooms
 * POST /api/rooms - Create room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';

/**
 * GET /api/rooms
 * List all rooms for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

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

    const [rooms, total] = await Promise.all([
      db.room.findMany({
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
      db.room.count({ where }),
    ]);

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
    return NextResponse.json(
      { error: 'Failed to list rooms' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms
 * Create a new room
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, templateId, allowDownloads, defaultExpiryDays } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Room name is required' },
        { status: 400 }
      );
    }

    // Generate slug from name
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);

    // If templateId provided, copy structure from template
    let templateFolders: Array<{ name: string; path: string }> = [];

    if (templateId) {
      const template = await db.roomTemplate.findFirst({
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
        const structure = template.folderStructure as { folders?: Array<{ name: string; path: string }> };
        templateFolders = structure.folders ?? [];
      }
    }

    // Create room
    const room = await db.room.create({
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
      await db.folder.create({
        data: {
          organizationId: session.organizationId,
          roomId: room.id,
          name: folder.name,
          path: folder.path,
        },
      });
    }

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    console.error('[RoomsAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    );
  }
}
