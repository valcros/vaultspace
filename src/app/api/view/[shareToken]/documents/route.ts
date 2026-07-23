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
          allowViewerVersionHistory: true,
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
      totalVersions: true,
      withdrawnAt: true,
      mimeType: true,
      fileSize: true,
      folderId: true,
      createdAt: true,
      folder: { select: { path: true } },
    };

    // Use RLS context for org-scoped queries
    const { folders, documents, trail, folderContextId } = await withOrgContext(
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
          return { folders: [], documents: documentsResult, trail: [], folderContextId: null };
        }

        // Resolve the folder the viewer is currently inside. At the root, a
        // folder-scoped link uses its scoped folder as the base.
        const baseFolderId = scope === 'FOLDER' && scopedFolderId ? scopedFolderId : null;
        let currentFolderId: string | null = baseFolderId;
        let resolvedTrail: Array<{ id: string; name: string }> = [];
        if (requestedFolderId) {
          // Reconstruct the breadcrumb from immutable parent ids. This also
          // proves that a requested folder is inside a folder-scoped link's
          // subtree before any contents are returned.
          let current = await tx.folder.findFirst({
            where: { id: requestedFolderId, roomId: viewerSession.room.id },
            select: { id: true, name: true, parentId: true },
          });

          const reverseTrail: Array<{ id: string; name: string }> = [];
          const visited = new Set<string>();
          let isAccessible = false;

          while (current && !visited.has(current.id)) {
            visited.add(current.id);

            if (baseFolderId && current.id === baseFolderId) {
              isAccessible = true;
              break;
            }

            reverseTrail.push({ id: current.id, name: current.name });
            if (!current.parentId) {
              isAccessible = baseFolderId === null;
              break;
            }

            current = await tx.folder.findFirst({
              where: { id: current.parentId, roomId: viewerSession.room.id },
              select: { id: true, name: true, parentId: true },
            });
          }

          if (isAccessible) {
            currentFolderId = requestedFolderId;
            resolvedTrail = reverseTrail.reverse();
          }
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

        return {
          folders: foldersResult,
          documents: documentsResult,
          trail: resolvedTrail,
          // The scoped folder itself is the viewer's logical root, so it does
          // not need to appear in the URL or breadcrumb.
          folderContextId: currentFolderId === baseFolderId ? null : currentFolderId,
        };
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
        versionHistoryEnabled: viewerSession.room.allowViewerVersionHistory,
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
        totalVersions: d.totalVersions ?? 1,
        withdrawn: d.withdrawnAt !== null,
        mimeType: d.mimeType,
        size: Number(d.fileSize),
        folderId: d.folderId,
        folderPath: d.folder?.path || null,
        createdAt: d.createdAt.toISOString(),
      })),
      trail,
      folderContextId,
    });
  } catch (error) {
    console.error('[ViewerDocumentsAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}
