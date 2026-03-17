/**
 * Trash Management API (F114)
 *
 * GET /api/rooms/:roomId/trash - List deleted documents
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

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
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get organization retention settings
      const organization = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: { trashRetentionDays: true },
      });

      const retentionDays = organization?.trashRetentionDays ?? 30;

      // Get soft-deleted documents
      const deletedDocuments = await tx.document.findMany({
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

      return { deletedDocuments, retentionDays };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Calculate permanent deletion dates
    const documentsWithDeletionDates = result.deletedDocuments.map((doc) => {
      const deletedAt = doc.deletedAt!;
      const permanentDeletionDate = new Date(deletedAt);
      permanentDeletionDate.setDate(permanentDeletionDate.getDate() + result.retentionDays);

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
      retentionDays: result.retentionDays,
    });
  } catch (error) {
    console.error('[TrashAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list trash' }, { status: 500 });
  }
}
