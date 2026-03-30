/**
 * Cleanup Seed Documents API
 *
 * POST /api/rooms/:roomId/cleanup-seed
 *
 * Removes documents whose file blobs don't exist in storage.
 * These are seed/demo documents with placeholder metadata but no actual files.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const providers = getProviders();
    const storage = providers.storage;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
      });
      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get all active documents with their file blobs
      const documents = await tx.document.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: {
              fileBlob: { select: { storageKey: true, storageBucket: true } },
            },
          },
        },
      });

      const toDelete: string[] = [];

      for (const doc of documents) {
        const version = doc.versions[0];
        if (!version || !version.fileBlob) {
          // No version or no file blob — seed document
          toDelete.push(doc.id);
          continue;
        }

        // Check if the file actually exists in storage
        const bucket = version.fileBlob.storageBucket || 'documents';
        const key = version.fileBlob.storageKey;
        try {
          const exists = await storage.exists(bucket, key);
          if (!exists) {
            toDelete.push(doc.id);
          }
        } catch {
          // Storage error — mark for deletion
          toDelete.push(doc.id);
        }
      }

      // Soft-delete the seed documents
      if (toDelete.length > 0) {
        await tx.document.updateMany({
          where: { id: { in: toDelete } },
          data: { status: 'DELETED', deletedAt: new Date() },
        });

        // Update room document count
        await tx.room.update({
          where: { id: roomId },
          data: { totalDocuments: { decrement: toDelete.length } },
        });
      }

      return { deleted: toDelete.length, total: documents.length };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      remaining: result.total - result.deleted,
      message: `Removed ${result.deleted} documents without files (${result.total - result.deleted} remaining)`,
    });
  } catch (error) {
    console.error('[CleanupSeedAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}
