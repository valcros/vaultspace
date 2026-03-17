/**
 * Admin Document Download API
 *
 * GET /api/rooms/:roomId/documents/:documentId/download - Download document
 *
 * Streams the document file to the authenticated admin user.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/download
 * Download document as authenticated admin
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get document with its latest version and file blob
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: {
              fileBlob: {
                select: {
                  storageKey: true,
                  storageBucket: true,
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
      if (!latestVersion || !latestVersion.fileBlob) {
        return { error: 'Document version not found', status: 404 };
      }

      // Record the download event
      await tx.document.update({
        where: { id: document.id },
        data: {
          downloadCount: { increment: 1 },
        },
      });

      return { document, latestVersion };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { document, latestVersion } = result;

    // Get storage provider
    const providers = getProviders();
    const storage = providers.storage;

    const bucket = latestVersion.fileBlob!.storageBucket || 'documents';
    const key = latestVersion.fileBlob!.storageKey;

    // Check if file exists
    const exists = await storage.exists(bucket, key);
    if (!exists) {
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    // Get file content
    const data = await storage.get(bucket, key);
    const mimeType = document.mimeType || 'application/octet-stream';
    const filename = document.name;

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
    console.error('[AdminDownloadAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
