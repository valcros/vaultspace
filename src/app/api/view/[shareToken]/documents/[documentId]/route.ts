/**
 * Viewer Document API
 *
 * GET /api/view/[shareToken]/documents/[documentId] - Get document details for viewer
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
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
          scope: true,
          scopedDocumentId: true,
        },
      },
      room: {
        select: {
          id: true,
          allowDownloads: true,
        },
      },
    },
  });

  return session;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 401 }
      );
    }

    // Check if document is allowed by link scope
    if (session.link?.scope === 'DOCUMENT' && session.link.scopedDocumentId !== documentId) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const document = await db.document.findFirst({
      where: {
        id: documentId,
        roomId: session.room.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        allowDownload: true,
        currentVersionId: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: {
            previewAssets: {
              where: { assetType: 'RENDER' },
              select: { pageNumber: true },
            },
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Update view count
    await db.document.update({
      where: { id: document.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    });

    // Get page count from preview assets
    const pageCount = document.versions[0]?.previewAssets?.length || 1;

    // Generate watermark text if session has email
    let watermarkText = null;
    if (session.visitorEmail) {
      watermarkText = `${session.visitorEmail} • ${new Date().toISOString().split('T')[0]}`;
    }

    return NextResponse.json({
      document: {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        pageCount,
        previewUrl: `/api/view/${shareToken}/documents/${documentId}/preview`,
        downloadEnabled: session.room.allowDownloads && document.allowDownload,
        watermarkText,
      },
    });
  } catch (error) {
    console.error('[ViewerDocumentAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load document' },
      { status: 500 }
    );
  }
}
