/**
 * Folder Management API
 *
 * POST /api/rooms/:roomId/folders - Create a new folder
 * GET /api/rooms/:roomId/folders - List folders in a room
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Folder } from '@prisma/client';

// Type for folder with include counts
type FolderWithCounts = Folder & {
  _count: {
    children: number;
    documents: number;
  };
};

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { HTTP_STATUS } from '@/lib/constants';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * POST /api/rooms/:roomId/folders
 * Create a new folder in a room
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Require ADMIN role to create folders
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: HTTP_STATUS.FORBIDDEN }
      );
    }

    const body = await request.json();
    const { name, parentId } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Folder name is required' },
        },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const folderName = name.trim();

    // Validate folder name
    if (folderName.length > 255) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Folder name too long (max 255 characters)' },
        },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Check for invalid characters
    if (/[<>:"/\\|?*]/.test(folderName)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Folder name contains invalid characters' },
        },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(
      session.organizationId,
      async (tx: Prisma.TransactionClient) => {
        // Verify room access
        const room = await tx.room.findFirst({
          where: {
            id: roomId,
            organizationId: session.organizationId,
          },
        });

        if (!room) {
          return { error: 'Room not found', status: HTTP_STATUS.NOT_FOUND };
        }

        // If parentId provided, verify it exists and belongs to this room
        let parentPath = '';
        if (parentId) {
          const parentFolder = await tx.folder.findFirst({
            where: {
              id: parentId,
              roomId,
              organizationId: session.organizationId,
            },
          });

          if (!parentFolder) {
            return { error: 'Parent folder not found', status: HTTP_STATUS.NOT_FOUND };
          }
          parentPath = parentFolder.path;
        }

        // Build the full path
        const path = parentPath ? `${parentPath}/${folderName}` : `/${folderName}`;

        // Check for duplicate folder name at same level
        const existing = await tx.folder.findFirst({
          where: {
            roomId,
            organizationId: session.organizationId,
            path,
          },
        });

        if (existing) {
          return { error: 'A folder with this name already exists', status: HTTP_STATUS.CONFLICT };
        }

        // Get display order (place at end)
        const maxOrder = await tx.folder.aggregate({
          where: {
            roomId,
            organizationId: session.organizationId,
            parentId: parentId || null,
          },
          _max: { displayOrder: true },
        });

        const displayOrder = (maxOrder._max.displayOrder ?? -1) + 1;

        // Create the folder
        const folder = await tx.folder.create({
          data: {
            organizationId: session.organizationId,
            roomId,
            parentId: parentId || null,
            name: folderName,
            path,
            displayOrder,
          },
        });

        return { folder };
      }
    );

    if ('error' in result) {
      return NextResponse.json(
        { success: false, error: { message: result.error } },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { success: true, folder: result.folder },
      { status: HTTP_STATUS.CREATED }
    );
  } catch (error) {
    console.error('[FoldersAPI] POST error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to create folder' } },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * GET /api/rooms/:roomId/folders
 * List folders in a room
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    const searchParams = request.nextUrl.searchParams;
    const parentId = searchParams.get('parentId') || undefined;

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(
      session.organizationId,
      async (tx: Prisma.TransactionClient) => {
        // Verify room access
        const room = await tx.room.findFirst({
          where: {
            id: roomId,
            organizationId: session.organizationId,
          },
        });

        if (!room) {
          return { error: 'Room not found', status: HTTP_STATUS.NOT_FOUND };
        }

        // Get folders
        const folders = await tx.folder.findMany({
          where: {
            roomId,
            organizationId: session.organizationId,
            parentId: parentId || null,
          },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          include: {
            _count: {
              select: {
                children: true,
                documents: true,
              },
            },
          },
        });

        return { folders };
      }
    );

    if ('error' in result) {
      return NextResponse.json(
        { success: false, error: { message: result.error } },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      folders: result.folders.map((f: FolderWithCounts) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        parentId: f.parentId,
        displayOrder: f.displayOrder,
        childCount: f._count.children,
        documentCount: f._count.documents,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[FoldersAPI] GET error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to list folders' } },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
