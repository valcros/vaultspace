/**
 * Viewer Document Download API
 *
 * GET /api/view/[shareToken]/documents/[documentId]/download - Download document
 *
 * Streams the document file to the client with appropriate headers.
 */

import { NextRequest, NextResponse } from 'next/server';

import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from '@/lib/audit/accessAudit';
import { withOrgContext } from '@/lib/db';
import { isServable, SERVABLE_SCAN_STATUS_FILTER } from '@/lib/documents/scanGate';
import { getRequestContext } from '@/lib/middleware';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';
import { canViewerLinkAccessDocument } from '@/lib/viewerLinkScope';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const reqContext = getRequestContext(request);
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      visitorEmail: true,
      room: {
        select: {
          id: true,
          allowDownloads: true,
          allowViewerVersionHistory: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return sessionResult.response;
    }
    const viewerSession = sessionResult.session;

    // Download is gated on the LINK's permission, not the room. This lets an
    // admin selectively grant download to one party (a DOWNLOAD link) without
    // opening the room room-wide; a VIEW link is always view-only.
    if (viewerSession.link.permission !== 'DOWNLOAD') {
      return NextResponse.json(
        { error: 'This link is view-only; downloads are not permitted' },
        { status: 403 }
      );
    }

    // Downloading a specific prior version is only allowed when the room exposes
    // version history to viewers; otherwise only the current version is served.
    const versionId = request.nextUrl.searchParams.get('versionId');
    if (versionId && !viewerSession.room.allowViewerVersionHistory) {
      return NextResponse.json(
        { error: 'Version history is not available for this room' },
        { status: 403 }
      );
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(viewerSession.organizationId, async (tx) => {
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          status: 'ACTIVE',
          withdrawnAt: null, // withdrawn documents are not accessible
        },
        select: {
          id: true,
          name: true,
          mimeType: true,
          folderId: true,
          allowDownload: true,
          currentVersionId: true,
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      const allowed = await canViewerLinkAccessDocument(
        tx,
        viewerSession.link,
        viewerSession.room.id,
        document
      );
      if (!allowed) {
        return { error: 'Document not found', status: 404 };
      }

      // Check document-level download permission
      if (!document.allowDownload) {
        return { error: 'Downloads are not allowed for this document', status: 403 };
      }

      const versionInclude = {
        fileBlob: { select: { storageKey: true, storageBucket: true } },
      };

      // Resolve the version to serve. Only CLEAN / SKIPPED versions are ever
      // served; an INFECTED / still-scanning version is never served, and the
      // response is identical (404) whether it is scanning or blocked -- viewers
      // are not told which.
      let targetVersion;
      if (versionId) {
        // Explicit historical version (already gated on room feature above):
        // load that exact version, servable only.
        targetVersion = await tx.documentVersion.findFirst({
          where: {
            id: versionId,
            documentId,
            organizationId: viewerSession.organizationId,
            ...SERVABLE_SCAN_STATUS_FILTER,
          },
          include: versionInclude,
        });
      } else if (document.currentVersionId) {
        // Default: serve the CURRENT version exactly (follows rollback; never
        // silently downgrades to an older version when the current one is not
        // servable).
        const current = await tx.documentVersion.findFirst({
          where: {
            id: document.currentVersionId,
            documentId,
            organizationId: viewerSession.organizationId,
          },
          include: versionInclude,
        });
        targetVersion = current && isServable(current.scanStatus) ? current : null;
      } else {
        // Legacy documents without a current pointer: highest servable version.
        targetVersion = await tx.documentVersion.findFirst({
          where: {
            documentId,
            organizationId: viewerSession.organizationId,
            ...SERVABLE_SCAN_STATUS_FILTER,
          },
          orderBy: { versionNumber: 'desc' },
          include: versionInclude,
        });
      }

      if (!targetVersion || !targetVersion.fileBlob) {
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
      organizationId: viewerSession.organizationId,
      eventType: 'DOCUMENT_DOWNLOADED',
      actorType: 'VIEWER',
      actorEmail: viewerSession.visitorEmail,
      roomId: viewerSession.room.id,
      documentId,
      viewSessionId: viewerSession.id,
      requestId: reqContext.requestId,
      description: 'Share-link viewer downloaded a document',
      metadata: {
        accessPath: 'SHARE_LINK',
        identityAssurance: viewerSession.visitorEmail ? 'ASSERTED_EMAIL' : 'ANONYMOUS',
      },
      ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
      userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
      dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.DOCUMENT_DOWNLOADED,
      touchViewerActivity: true,
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
    console.error('[ViewerDownloadAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
