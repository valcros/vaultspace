/**
 * Viewer Documents API
 *
 * GET /api/view/[shareToken]/documents - List documents for viewer
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

async function getViewerSession(shareToken: string) {
  const cookieStore = await cookies();
  const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

  if (!viewerToken) {
    return null;
  }

  const session = await db.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
    },
    include: {
      link: {
        select: {
          slug: true,
          scope: true,
          scopedFolderId: true,
          scopedDocumentId: true,
        },
      },
      room: {
        select: {
          id: true,
          name: true,
          allowDownloads: true,
        },
      },
      organization: {
        select: {
          name: true,
          logoUrl: true,
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
      return NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 401 }
      );
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

    // Get folders at current path
    const folders = await db.folder.findMany({
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
    const documents = await db.document.findMany({
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

    return NextResponse.json({
      session: {
        roomName: session.room.name,
        organizationName: session.organization.name,
        organizationLogo: session.organization.logoUrl,
        downloadEnabled: session.room.allowDownloads,
        watermarkEnabled: false, // Watermark not in current schema
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
    return NextResponse.json(
      { error: 'Failed to load documents' },
      { status: 500 }
    );
  }
}
