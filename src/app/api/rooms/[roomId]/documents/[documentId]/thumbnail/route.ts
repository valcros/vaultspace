/**
 * Document Thumbnail API
 *
 * GET /api/rooms/:roomId/documents/:documentId/thumbnail
 *
 * Returns a PNG thumbnail for grid view.
 * Path 1: Serve stored THUMBNAIL asset for ALL types.
 * Path 2: If no thumbnail, return branded placeholder IMMEDIATELY,
 *          then enqueue a thumbnail.generate job (fire-and-forget).
 * Never blocks on expensive Gotenberg generation.
 * Never returns 404 for a document with a file blob.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export const dynamic = 'force-dynamic';

// Color mapping for branded placeholder cards
const EXTENSION_COLORS: Record<string, { bg: string; text: string }> = {
  PDF: { bg: '#fef2f2', text: '#dc2626' },
  DOCX: { bg: '#eff6ff', text: '#2563eb' },
  DOC: { bg: '#eff6ff', text: '#2563eb' },
  XLSX: { bg: '#f0fdf4', text: '#16a34a' },
  XLS: { bg: '#f0fdf4', text: '#16a34a' },
  PPTX: { bg: '#fff7ed', text: '#ea580c' },
  PPT: { bg: '#fff7ed', text: '#ea580c' },
  CSV: { bg: '#f0fdf4', text: '#16a34a' },
  MD: { bg: '#f5f3ff', text: '#7c3aed' },
  HTML: { bg: '#fef3c7', text: '#d97706' },
  JSON: { bg: '#ecfdf5', text: '#059669' },
  XML: { bg: '#fef3c7', text: '#d97706' },
  YAML: { bg: '#fce7f3', text: '#db2777' },
  YML: { bg: '#fce7f3', text: '#db2777' },
  TXT: { bg: '#f9fafb', text: '#6b7280' },
  SVG: { bg: '#faf5ff', text: '#9333ea' },
  VSDX: { bg: '#faf5ff', text: '#9333ea' },
};

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
      });
      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

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
                select: { storageKey: true, storageBucket: true },
              },
              previewAssets: {
                where: { assetType: 'THUMBNAIL' },
                take: 1,
              },
            },
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      return { document };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    const { document } = result;
    const latestVersion = document.versions[0];
    if (!latestVersion) {
      return NextResponse.json({ error: 'No version' }, { status: 404 });
    }

    const providers = getProviders();
    const storage = providers.storage;

    // Path 1: Serve stored THUMBNAIL for ALL types (no PDF skip)
    const thumbnailAsset = latestVersion.previewAssets?.[0];
    if (thumbnailAsset) {
      try {
        const exists = await storage.exists('previews', thumbnailAsset.storageKey);
        if (exists) {
          const data = await storage.get('previews', thumbnailAsset.storageKey);
          if (data.length > 1000) {
            return new NextResponse(new Uint8Array(data), {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
                'Content-Length': data.length.toString(),
                'Cache-Control': 'private, max-age=300',
              },
            });
          }
        }
      } catch (err) {
        console.error('[ThumbnailAPI] Failed to serve stored thumbnail:', err);
      }
    }

    // Path 2: No stored thumbnail — return branded placeholder IMMEDIATELY
    // then enqueue a preview.generate job (fire-and-forget) which generates
    // the thumbnail inline from original file bytes.
    if (latestVersion.fileBlob) {
      // Fire-and-forget: enqueue full preview generation which includes inline thumbnail
      providers.job
        .addJob(
          'high',
          'preview.generate',
          {
            documentId,
            versionId: latestVersion.id,
            organizationId: session.organizationId,
            storageKey: latestVersion.fileBlob.storageKey,
            contentType: document.mimeType || 'application/octet-stream',
            fileName: document.name,
            fileSizeBytes: 0,
            isScanned: false,
          },
          { priority: 'normal' }
        )
        .catch((err: unknown) => {
          console.error('[ThumbnailAPI] Failed to enqueue preview job:', err);
        });
    }

    // Return branded placeholder immediately
    const placeholderPng = await generateBrandedPlaceholder(document.name);
    return new NextResponse(new Uint8Array(placeholderPng), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': placeholderPng.length.toString(),
        // Short cache so next load can pick up the real thumbnail
        'Cache-Control': 'private, max-age=30',
      },
    });
  } catch (error) {
    console.error('[ThumbnailAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get thumbnail' }, { status: 500 });
  }
}

/**
 * Generate a branded placeholder card via Sharp SVG (no Gotenberg dependency).
 * Fast and reliable — no network calls needed.
 */
async function generateBrandedPlaceholder(fileName: string): Promise<Buffer> {
  const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
  const color = EXTENSION_COLORS[ext] || { bg: '#f9fafb', text: '#6b7280' };
  const truncatedName =
    fileName.length > 30 ? fileName.slice(0, 27) + '...' : fileName;
  const escapedExt = escapeXml(ext);
  const escapedName = escapeXml(truncatedName);

  const width = 400;
  const height = 300;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${color.bg}" rx="8"/>
    <text x="50%" y="42%" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="48" font-weight="700" fill="${color.text}">${escapedExt}</text>
    <text x="50%" y="62%" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" fill="#6b7280">${escapedName}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).resize(200, 150).png().toBuffer();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
