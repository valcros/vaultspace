/**
 * Room Templates API (F109)
 *
 * GET  /api/rooms/templates - List available templates
 * POST /api/rooms/templates - Create custom template
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { BUILT_IN_ROOM_TEMPLATES } from '@/lib/rooms/starterFolderTemplates';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/templates
 * List available room templates (built-in + custom)
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await requireAuth();

    // Use RLS context for org-scoped queries
    const customTemplates = await withOrgContext(session.organizationId, async (tx) => {
      return tx.roomTemplate.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: { name: 'asc' },
      });
    });

    // Combine built-in and custom templates
    const templates = [
      ...BUILT_IN_ROOM_TEMPLATES.map((t) => ({
        ...t,
        isCustom: false,
      })),
      ...customTemplates.map((t) => ({
        ...t,
        isCustom: true,
      })),
    ];

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[TemplatesAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list templates' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/templates
 * Create a custom template (optionally from existing room)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, fromRoomId, structure } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
    }

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      let templateStructure = structure;

      // If creating from existing room, copy its folder structure
      if (fromRoomId) {
        const room = await tx.room.findFirst({
          where: {
            id: fromRoomId,
            organizationId: session.organizationId,
          },
          include: {
            folders: {
              select: {
                name: true,
                path: true,
                parentId: true,
              },
              orderBy: { path: 'asc' },
            },
          },
        });

        if (!room) {
          return { error: 'Source room not found', status: 404 };
        }

        templateStructure = {
          folders: room.folders.map((f) => ({
            name: f.name,
            path: f.path,
          })),
        };
      }

      if (!templateStructure) {
        return { error: 'Template structure is required (or provide fromRoomId)', status: 400 };
      }

      // Create template
      const template = await tx.roomTemplate.create({
        data: {
          organizationId: session.organizationId,
          name: name.trim(),
          description: description?.trim(),
          category: body.category ?? 'custom',
          folderStructure: templateStructure,
          isSystemTemplate: false,
          isPublic: false,
        },
      });

      return { template };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ template: result.template }, { status: 201 });
  } catch (error) {
    console.error('[TemplatesAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
