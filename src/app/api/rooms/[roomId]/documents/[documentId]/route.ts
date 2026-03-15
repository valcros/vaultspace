/**
 * Document Management API
 *
 * GET    /api/rooms/:roomId/documents/:documentId - Get document details
 * PATCH  /api/rooms/:roomId/documents/:documentId - Update document metadata/tags
 * DELETE /api/rooms/:roomId/documents/:documentId - Soft delete document
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId
 * Get document details including versions
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get document with versions
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        roomId,
        organizationId: session.organizationId,
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 10,
          include: {
            previewAssets: {
              where: { assetType: 'THUMBNAIL' },
              take: 1,
            },
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error('[DocumentAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get document' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/rooms/:roomId/documents/:documentId
 * Update document metadata and tags (F110)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get current document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        roomId,
        organizationId: session.organizationId,
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      tags,
      customMetadata,
      displayOrder,
      allowDownload,
      folderId,
      batesNumber,
    } = body;

    // Validate tags if provided
    if (tags !== undefined) {
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
        return NextResponse.json(
          { error: 'Tags must be an array of strings' },
          { status: 400 }
        );
      }
    }

    // Validate folder if provided
    if (folderId) {
      const folder = await db.folder.findFirst({
        where: {
          id: folderId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!folder) {
        return NextResponse.json(
          { error: 'Folder not found' },
          { status: 404 }
        );
      }
    }

    // Update document
    const updatedDocument = await db.document.update({
      where: { id: documentId },
      data: {
        ...(name && { name: name.trim() }),
        ...(tags !== undefined && { tags }),
        ...(customMetadata !== undefined && { customMetadata }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(allowDownload !== undefined && { allowDownload }),
        ...(folderId !== undefined && { folderId }),
        ...(batesNumber !== undefined && { batesNumber }),
      },
    });

    // Update search index with new metadata
    const searchIndex = await db.searchIndex.findFirst({
      where: {
        documentId,
        organizationId: session.organizationId,
      },
    });

    if (searchIndex) {
      await db.searchIndex.update({
        where: { id: searchIndex.id },
        data: {
          ...(tags !== undefined && { tags }),
          ...(customMetadata !== undefined && { customMetadata }),
          ...(name && { documentTitle: name.trim() }),
        },
      });
    }

    return NextResponse.json({ document: updatedDocument });
  } catch (error) {
    console.error('[DocumentAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update document' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rooms/:roomId/documents/:documentId
 * Soft delete document (move to trash) (F114)
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get current document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        roomId,
        organizationId: session.organizationId,
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Soft delete - move to DELETED status
    await db.document.update({
      where: { id: documentId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DocumentAPI] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}
