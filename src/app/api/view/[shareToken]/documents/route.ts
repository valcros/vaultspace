/**
 * Viewer Documents API
 *
 * GET /api/view/[shareToken]/documents - List documents for viewer
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db, withOrgContext } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

/**
 * PRE-RLS BOOTSTRAP: Resolve viewer session from token
 *
 * This is intentionally a narrowly scoped raw db lookup to bootstrap
 * viewer context. The sessionToken is a secret that proves the viewer
 * has already been authenticated via /api/view/[shareToken]/access.
 * Once we have the session, we use its organizationId to enter RLS context.
 */
async function getViewerSession(shareToken: string) {
  const cookieStore = await cookies();
  const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

  if (!viewerToken) {
    return null;
  }

  // Bootstrap lookup by session token - returns organizationId for RLS context
  const session = await db.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
    },
    select: {
      id: true,
      createdAt: true,
      organizationId: true,
      roomId: true,
      link: {
        select: {
          slug: true,
          scope: true,
          scopedFolderId: true,
          scopedDocumentId: true,
          maxSessionMinutes: true,
        },
      },
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
    },
  });

  return session;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    // Enforce per-session time limit (F021)
    if (session.link?.maxSessionMinutes) {
      const elapsed = (Date.now() - session.createdAt.getTime()) / 1000 / 60;
      if (elapsed > session.link.maxSessionMinutes) {
        return NextResponse.json({ error: 'Session time limit exceeded' }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '';

    // Build folder query based on link scope
    const folderWhere: Record<string, unknown> = {
      roomId: session.room.id,
    };

    if (path) {
      folderWhere['path'] = path;
    } else {
      folderWhere['parentId'] = null;
    }

    // If link is scoped to a specific folder, only show that folder's contents
    if (session.link?.scope === 'FOLDER' && session.link.scopedFolderId) {
      folderWhere['parentId'] = session.link.scopedFolderId;
    }

    // Use RLS context for org-scoped queries
    const { folders, documents } = await withOrgContext(session.organizationId, async (tx) => {
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
        roomId: session.room.id,
        status: 'ACTIVE',
      };

      if (path) {
        documentWhere['folder'] = { path };
      } else {
        documentWhere['folderId'] = null;
      }

      // If link is scoped to a specific document, only show that document
      if (session.link?.scope === 'DOCUMENT' && session.link.scopedDocumentId) {
        documentWhere['id'] = session.link.scopedDocumentId;
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
    });

    return NextResponse.json({
      session: {
        roomName: session.room.name,
        organizationName: session.organization.name,
        organizationLogo: session.room.brandLogoUrl || session.organization.logoUrl,
        brandColor: session.room.brandColor || session.organization.primaryColor,
        downloadEnabled: session.room.allowDownloads,
        watermarkEnabled: session.room.enableWatermark,
        watermarkTemplate: session.room.watermarkTemplate,
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
