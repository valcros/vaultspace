/**
 * Viewer Document Version History API
 *
 * GET /api/view/[shareToken]/documents/[documentId]/versions
 *
 * Lists a document's prior versions to a viewer, but only when the room has
 * opted in via allowViewerVersionHistory. Downloading a specific version is
 * still gated by the link's permission (see the download route's versionId
 * support).
 */

import { NextRequest, NextResponse } from 'next/server';

import { withOrgContext } from '@/lib/db';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      room: {
        select: {
          id: true,
          allowViewerVersionHistory: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return sessionResult.response;
    }
    const viewerSession = sessionResult.session;

    if (!viewerSession.room.allowViewerVersionHistory) {
      return NextResponse.json(
        { error: 'Version history is not available for this room' },
        { status: 403 }
      );
    }

    // A document-scoped link may only see its own document.
    if (
      viewerSession.link.scope === 'DOCUMENT' &&
      viewerSession.link.scopedDocumentId !== documentId
    ) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const result = await withOrgContext(viewerSession.organizationId, async (tx) => {
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          status: 'ACTIVE',
          withdrawnAt: null,
        },
        select: { id: true, currentVersionId: true },
      });
      if (!document) {
        return null;
      }
      const versions = await tx.documentVersion.findMany({
        where: { documentId, organizationId: viewerSession.organizationId, scanStatus: 'CLEAN' },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true, fileSize: true, createdAt: true },
      });
      return { document, versions };
    });

    if (!result) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json({
      downloadEnabled: viewerSession.link.permission === 'DOWNLOAD',
      versions: result.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        size: Number(v.fileSize),
        createdAt: v.createdAt.toISOString(),
        isCurrent: v.id === result.document.currentVersionId,
      })),
    });
  } catch (error) {
    console.error('[ViewerVersionsAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load version history' }, { status: 500 });
  }
}
