/**
 * Document Version Rollback API
 *
 * POST /api/rooms/:roomId/documents/:documentId/versions/:versionId/rollback
 * Rollback a document to a previous version
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string; versionId: string }>;
}

/**
 * POST /api/rooms/:roomId/documents/:documentId/versions/:versionId/rollback
 * Rollback a document to the specified version
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId, versionId } = await context.params;

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

      // Get document
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Get target version
      const targetVersion = await tx.documentVersion.findFirst({
        where: {
          id: versionId,
          documentId,
          organizationId: session.organizationId,
        },
        include: {
          uploadedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!targetVersion) {
        return { error: 'Version not found', status: 404 };
      }

      // Check if version is already current
      if (document.currentVersionId === versionId) {
        return { error: 'Version is already the current version', status: 400 };
      }

      // Check scan status - cannot rollback to an infected version
      if (targetVersion.scanStatus !== 'CLEAN') {
        return {
          error: 'Cannot rollback to a version that has not passed virus scanning',
          status: 400,
        };
      }

      // Update document to point to the target version
      const updatedDocument = await tx.document.update({
        where: { id: documentId },
        data: {
          currentVersionId: versionId,
          mimeType: targetVersion.mimeType,
          fileSize: targetVersion.fileSize,
        },
      });

      // Create audit event for tracking
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'DOCUMENT_UPDATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          documentId,
          description: `Document rolled back to version ${targetVersion.versionNumber}`,
          metadata: {
            action: 'ROLLBACK',
            targetVersionId: versionId,
            targetVersionNumber: targetVersion.versionNumber,
            previousVersionId: document.currentVersionId,
          },
        },
      });

      return { document: updatedDocument, version: targetVersion };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      document: result.document,
      version: result.version,
    });
  } catch (error) {
    console.error('[RollbackAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to rollback version' }, { status: 500 });
  }
}
