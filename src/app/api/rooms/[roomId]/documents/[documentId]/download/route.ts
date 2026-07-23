/**
 * Admin Document Download API
 *
 * GET /api/rooms/:roomId/documents/:documentId/download - Download document
 *
 * Streams the document file to the authenticated admin user.
 */

import { NextRequest, NextResponse } from 'next/server';

import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from '@/lib/audit/accessAudit';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { isServable, SERVABLE_SCAN_STATUS_FILTER } from '@/lib/documents/scanGate';
import { getRequestContext, requireAuth } from '@/lib/middleware';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/download
 * Download document as authenticated admin
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;
    const reqContext = getRequestContext(request);

    // Use RLS context for all org-scoped queries
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

      // Get the document and its current-version pointer.
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true, name: true, mimeType: true, currentVersionId: true },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      const versionInclude = {
        fileBlob: { select: { storageKey: true, storageBucket: true } },
      };

      // Serve the CURRENT version exactly. This follows rollback and never
      // silently downgrades to an older version when the current one is not
      // servable. Only when there is no current pointer (legacy documents) do we
      // fall back to the highest servable version -- with no pointer there is
      // nothing to downgrade from.
      const targetVersion = document.currentVersionId
        ? await tx.documentVersion.findFirst({
            where: {
              id: document.currentVersionId,
              documentId,
              organizationId: session.organizationId,
            },
            include: versionInclude,
          })
        : await tx.documentVersion.findFirst({
            where: {
              documentId,
              organizationId: session.organizationId,
              ...SERVABLE_SCAN_STATUS_FILTER,
            },
            orderBy: { versionNumber: 'desc' },
            include: versionInclude,
          });

      // Order matters: a present-but-non-servable version is a 403 regardless of
      // whether its blob row happens to be missing, so the scan gate is checked
      // before the blob. (1) no version row -> 404; (2) non-servable -> 403;
      // (3) servable but blob missing (data inconsistency) -> 404.
      if (!targetVersion) {
        return { error: 'Document version not found', status: 404 };
      }
      // Never serve an INFECTED / still-scanning current version; only CLEAN or
      // SKIPPED. Return the same 403 whether it is still scanning or blocked.
      if (!isServable(targetVersion.scanStatus)) {
        return { error: 'This document is not available for download', status: 403 };
      }
      if (!targetVersion.fileBlob) {
        return { error: 'Document version not found', status: 404 };
      }

      // Record the download event
      await tx.document.update({
        where: { id: document.id },
        data: {
          downloadCount: { increment: 1 },
        },
      });

      return { document, targetVersion };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { document, targetVersion } = result;

    // Get storage provider
    const providers = getProviders();
    const storage = providers.storage;

    const bucket = targetVersion.fileBlob!.storageBucket || 'documents';
    const key = targetVersion.fileBlob!.storageKey;

    // Check if file exists
    const exists = await storage.exists(bucket, key);
    if (!exists) {
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    // Get file content
    const data = await storage.get(bucket, key);
    const mimeType = document.mimeType || 'application/octet-stream';
    const filename = document.name;

    await captureAccessAudit({
      organizationId: session.organizationId,
      eventType: 'DOCUMENT_DOWNLOADED',
      actorType: session.organization.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
      actorId: session.userId,
      actorEmail: session.user.email,
      roomId,
      documentId,
      requestId: reqContext.requestId,
      description: 'Authenticated user downloaded a document',
      metadata: { accessPath: 'AUTHENTICATED_DOWNLOAD' },
      ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
      userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
      dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.DOCUMENT_DOWNLOADED,
    });

    // Return file with download headers
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': data.length.toString(),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    console.error('[AdminDownloadAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
