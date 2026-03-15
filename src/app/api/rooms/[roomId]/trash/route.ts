/**
 * Trash Management API (F114)
 *
 * GET /api/rooms/:roomId/trash - List deleted documents
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/trash
 * List soft-deleted documents (trash)
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

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

    // Get organization retention settings
    const organization = await db.organization.findUnique({
      where: { id: session.organizationId },
      select: { trashRetentionDays: true },
    });

    const retentionDays = organization?.trashRetentionDays ?? 30;

    // Get soft-deleted documents
    const deletedDocuments = await db.document.findMany({
      where: {
        roomId,
        organizationId: session.organizationId,
        status: 'DELETED',
        deletedAt: { not: null },
      },
      include: {
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: {
            uploadedByUser: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { deletedAt: 'desc' },
    });

    // Calculate permanent deletion dates
    const documentsWithDeletionDates = deletedDocuments.map((doc) => {
      const deletedAt = doc.deletedAt!;
      const permanentDeletionDate = new Date(deletedAt);
      permanentDeletionDate.setDate(permanentDeletionDate.getDate() + retentionDays);

      return {
        ...doc,
        permanentDeletionDate,
        daysUntilPermanentDeletion: Math.max(
          0,
          Math.ceil((permanentDeletionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        ),
      };
    });

    return NextResponse.json({
      documents: documentsWithDeletionDates,
      retentionDays,
    });
  } catch (error) {
    console.error('[TrashAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list trash' },
      { status: 500 }
    );
  }
}
