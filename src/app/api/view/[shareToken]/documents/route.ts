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

    // Build folder query based on link scope
    const folderWhere: Record<string, unknown> = {
      roomId: viewerSession.room.id,
    };

    if (path) {
      folderWhere['path'] = path;
    } else {
      folderWhere['parentId'] = null;
    }

    // If link is scoped to a specific folder, only show that folder's contents
    if (viewerSession.link.scope === 'FOLDER' && viewerSession.link.scopedFolderId) {
      folderWhere['parentId'] = viewerSession.link.scopedFolderId;
    }

    // Use RLS context for org-scoped queries
    const { folders, documents } = await withOrgContext(
      viewerSession.organizationId,
      async (tx) => {
        // Get folders at current path
        const foldersResult = await tx.folder.findMany({
          where: folderWhere,
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: { documents: true },
            },
          },
        });

        // Build document query based on link scope
        const documentWhere: Record<string, unknown> = {
          roomId: viewerSession.room.id,
          status: 'ACTIVE',
        };

        if (path) {
          documentWhere['folder'] = { path };
        } else {
          documentWhere['folderId'] = null;
        }

        // If link is scoped to a specific document, only show that document
        if (viewerSession.link.scope === 'DOCUMENT' && viewerSession.link.scopedDocumentId) {
          documentWhere['id'] = viewerSession.link.scopedDocumentId;
        }

        // Get documents at current path
        const documentsResult = await tx.document.findMany({
          where: documentWhere,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            mimeType: true,
            fileSize: true,
            folderId: true,
            createdAt: true,
            folder: {
              select: { path: true },
            },
          },
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
        downloadEnabled: viewerSession.room.allowDownloads,
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
