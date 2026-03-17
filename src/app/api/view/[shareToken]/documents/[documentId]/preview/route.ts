/**
 * Viewer Document Preview API
 *
 * GET /api/view/[shareToken]/documents/[documentId]/preview - Get document preview image
 *
 * Returns a redirect to a signed URL for the preview image, or the image directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db, withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

/**
 * PRE-RLS BOOTSTRAP: Resolve viewer session from token
 * Returns organizationId for subsequent RLS context
 */
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
    select: {
      organizationId: true,
      link: {
        select: {
          scope: true,
          scopedDocumentId: true,
        },
      },
      room: {
        select: {
          id: true,
        },
      },
    },
  });

  return session;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    // Check if document is allowed by link scope
    if (session.link?.scope === 'DOCUMENT' && session.link.scopedDocumentId !== documentId) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get page number from query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Get document with its latest version
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: session.room.id,
          status: 'ACTIVE',
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: {
              previewAssets: {
                where: {
                  assetType: 'RENDER',
                  pageNumber: page,
                },
                select: {
                  storageKey: true,
                  mimeType: true,
                },
              },
            },
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      const latestVersion = document.versions[0];
      if (!latestVersion) {
        return { error: 'Document version not found', status: 404 };
      }

      return { document, latestVersion };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { latestVersion } = result;

    const previewAsset = latestVersion.previewAssets[0];
    if (!previewAsset) {
      // Return a placeholder response if no preview is available yet
      return NextResponse.json(
        { error: 'Preview not available', processing: true },
        { status: 202 }
      );
    }

    // Get storage provider and generate signed URL
    const providers = getProviders();
    const storage = providers.storage;

    const bucket = 'previews';
    const key = previewAsset.storageKey;

    // Check if file exists
    const exists = await storage.exists(bucket, key);
    if (!exists) {
      return NextResponse.json(
        { error: 'Preview file not found', processing: true },
        { status: 202 }
      );
    }

    // Get the file and return it directly (more reliable than redirect for images)
    const data = await storage.get(bucket, key);
    const mimeType = previewAsset.mimeType || 'image/png';

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': data.length.toString(),
        'Cache-Control': 'private, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('[ViewerPreviewAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get preview' }, { status: 500 });
  }
}
