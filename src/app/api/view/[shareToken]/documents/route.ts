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
    const path = searchParams.get('path') || '';
    // Folder paths are stored with a leading slash (e.g. "/1. Corporate"). The
    // viewer builds a path by joining folder names with "/", which omits the
    // leading slash, so normalize before matching. Navigation keyed on the
    // display path is inherently fragile; resolving to a folder id here and
    // querying by parentId/folderId is the robust behaviour.
    const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';

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
        if (normalizedPath) {
          const current = await tx.folder.findFirst({
            where: { roomId: viewerSession.room.id, path: normalizedPath },
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
