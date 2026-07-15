/**
 * Viewer Documents API
 *
 * GET /api/view/[shareToken]/documents - List documents for viewer
 */

import { NextRequest, NextResponse } from 'next/server';

import { withOrgContext } from '@/lib/db';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      roomId: true,
      room: {
        select: {
          id: true,
          name: true,
          allowDownloads: true,
          enableWatermark: true,
          watermarkTemplate: true,
          brandColor: true,
          brandLogoUrl: true,
        },
      },
      organization: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return sessionResult.response;
    }
    const viewerSession = sessionResult.session;

    const { searchParams } = new URL(request.url);
    // Navigate by immutable folder id, not a display-derived path string. The
    // path-as-key approach previously caused every folder to open empty because
    // the stored path ("/1. Corporate") and the viewer-built path ("1. Corporate")
    // never matched.
    const requestedFolderId = searchParams.get('folderId');

    const scope = viewerSession.link.scope;
    const scopedFolderId = viewerSession.link.scopedFolderId;
    const scopedDocumentId = viewerSession.link.scopedDocumentId;

    const documentSelect = {
      id: true,
      name: true,
      accessionNumber: true,
      mimeType: true,
      fileSize: true,
      folderId: true,
      createdAt: true,
      folder: { select: { path: true } },
    };

    // Use RLS context for org-scoped queries
    const { folders, documents } = await withOrgContext(
      viewerSession.organizationId,
      async (tx) => {
        // A document-scoped link exposes exactly one document and no folder tree.
        if (scope === 'DOCUMENT' && scopedDocumentId) {
          const documentsResult = await tx.document.findMany({
            where: {
              roomId: viewerSession.room.id,
              status: 'ACTIVE',
              id: scopedDocumentId,
            },
            orderBy: { name: 'asc' },
            select: documentSelect,
          });
          return { folders: [], documents: documentsResult };
        }

        // Resolve the folder the viewer is currently inside. At the root, a
        // folder-scoped link uses its scoped folder as the base.
        let currentFolderId: string | null =
          scope === 'FOLDER' && scopedFolderId ? scopedFolderId : null;
        if (requestedFolderId) {
          // Verify the requested folder exists in this room before using it.
          const current = await tx.folder.findFirst({
            where: { id: requestedFolderId, roomId: viewerSession.room.id },
            select: { id: true },
          });
          if (!current) {
            return { folders: [], documents: [] };
          }
          currentFolderId = current.id;
        }

        // Subfolders are the children of the current folder (top-level at root).
        const foldersResult = await tx.folder.findMany({
          where: { roomId: viewerSession.room.id, parentId: currentFolderId },
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: { documents: true },
            },
          },
        });

        // Documents are those directly in the current folder (root when null).
        const documentsResult = await tx.document.findMany({
          where: {
            roomId: viewerSession.room.id,
            status: 'ACTIVE',
            folderId: currentFolderId,
          },
          orderBy: { name: 'asc' },
          select: documentSelect,
        });

        return { folders: foldersResult, documents: documentsResult };
      }
    );

    return NextResponse.json({
      session: {
        roomName: viewerSession.room.name,
        organizationName: viewerSession.organization.name,
        organizationLogo: viewerSession.room.brandLogoUrl || viewerSession.organization.logoUrl,
        brandColor: viewerSession.room.brandColor || viewerSession.organization.primaryColor,
        // Download availability follows the link's permission, not the room.
        downloadEnabled: viewerSession.link.permission === 'DOWNLOAD',
        watermarkEnabled: viewerSession.room.enableWatermark,
        watermarkTemplate: viewerSession.room.watermarkTemplate,
      },
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        documentCount: f._count.documents,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        name: d.name,
        accessionNumber: d.accessionNumber ?? null,
        mimeType: d.mimeType,
        size: Number(d.fileSize),
        folderId: d.folderId,
        folderPath: d.folder?.path || null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[ViewerDocumentsAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}
