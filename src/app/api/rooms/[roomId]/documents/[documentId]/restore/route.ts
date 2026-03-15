/**
 * Document Restore API (F114)
 *
 * POST /api/rooms/:roomId/documents/:documentId/restore - Restore from trash
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * POST /api/rooms/:roomId/documents/:documentId/restore
 * Restore a soft-deleted document from trash
 */
export async function POST(_request: NextRequest, context: RouteContext) {
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

    // Get document (must be deleted)
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        roomId,
        organizationId: session.organizationId,
        status: 'DELETED',
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found in trash' },
        { status: 404 }
      );
    }

    // Restore document
    const restoredDocument = await db.document.update({
      where: { id: documentId },
      data: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    // Update room statistics
    await db.room.update({
      where: { id: roomId },
      data: {
        totalDocuments: { increment: 1 },
      },
    });

    return NextResponse.json({ document: restoredDocument });
  } catch (error) {
    console.error('[RestoreAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to restore document' },
      { status: 500 }
    );
  }
}
