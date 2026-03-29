/**
 * Document Thumbnail API
 *
 * GET /api/rooms/:roomId/documents/:documentId/thumbnail
 *
 * Returns a PNG thumbnail for grid view. Falls back to generating one
 * from the original file for images, or returns 404 if no thumbnail exists.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export const dynamic = 'force-dynamic';

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

    // Try serving the THUMBNAIL asset first (skip if too small — likely a bad placeholder)
    const thumbnailAsset = latestVersion.previewAssets?.[0];
    if (thumbnailAsset) {
      const exists = await storage.exists('previews', thumbnailAsset.storageKey);
      if (exists) {
        const data = await storage.get('previews', thumbnailAsset.storageKey);
        // Only serve if the thumbnail is substantial (>2KB = real content)
        if (data.length > 2000) {
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
    }

    // For images, generate a thumbnail on the fly from the original file
    const mimeType = document.mimeType || '';
    if (mimeType.startsWith('image/') && latestVersion.fileBlob) {
      const bucket = latestVersion.fileBlob.storageBucket || 'documents';
      const key = latestVersion.fileBlob.storageKey;
      const exists = await storage.exists(bucket, key);
      if (exists) {
        const data = await storage.get(bucket, key);
        // Use sharp to resize to thumbnail
        const sharp = (await import('sharp')).default;
        const thumbnail = await sharp(Buffer.from(data))
          .resize(400, 300, { fit: 'cover', position: 'top' })
          .png({ quality: 80 })
          .toBuffer();

        return new NextResponse(new Uint8Array(thumbnail), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': thumbnail.length.toString(),
            'Cache-Control': 'private, max-age=300',
          },
        });
      }
    }

    // For types without pre-generated thumbnails, create a branded placeholder
    // using Gotenberg Chromium to render a styled HTML card as PNG
    if (latestVersion.fileBlob) {
      const gotenbergUrl = process.env['GOTENBERG_URL'] ?? 'http://localhost:3001';
      try {
        const ext = document.name.split('.').pop()?.toUpperCase() || 'FILE';
        const colors: Record<string, { bg: string; text: string }> = {
          PDF: { bg: '#fef2f2', text: '#dc2626' },
          DOCX: { bg: '#eff6ff', text: '#2563eb' },
          DOC: { bg: '#eff6ff', text: '#2563eb' },
          XLSX: { bg: '#f0fdf4', text: '#16a34a' },
          XLS: { bg: '#f0fdf4', text: '#16a34a' },
          PPTX: { bg: '#fff7ed', text: '#ea580c' },
          PPT: { bg: '#fff7ed', text: '#ea580c' },
          CSV: { bg: '#f0fdf4', text: '#16a34a' },
          VSDX: { bg: '#faf5ff', text: '#9333ea' },
        };
        const color = colors[ext] || { bg: '#f9fafb', text: '#6b7280' };
        const truncatedName =
          document.name.length > 30 ? document.name.slice(0, 27) + '...' : document.name;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
          <style>*{margin:0;padding:0;box-sizing:border-box}
          body{width:400px;height:300px;display:flex;align-items:center;justify-content:center;background:${color.bg};font-family:system-ui,-apple-system,sans-serif}
          .card{text-align:center;padding:20px}
          .ext{font-size:48px;font-weight:700;color:${color.text};letter-spacing:2px;margin-bottom:8px}
          .name{font-size:13px;color:#6b7280;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          </style></head>
          <body><div class="card"><div class="ext">${ext}</div><div class="name">${truncatedName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div></body></html>`;

        const boundary = `----Boundary${Date.now()}`;
        const header = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([header, Buffer.from(html, 'utf-8'), footer]);

        const ssResponse = await fetch(`${gotenbergUrl}/forms/chromium/screenshot/html`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(10000),
        });

        if (ssResponse.ok) {
          const pngData = Buffer.from(await ssResponse.arrayBuffer());
          if (pngData.length > 100) {
            return new NextResponse(new Uint8Array(pngData), {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
                'Content-Length': pngData.length.toString(),
                'Cache-Control': 'private, max-age=300',
              },
            });
          }
        }
      } catch (err) {
        console.error('[ThumbnailAPI] Placeholder generation failed:', err);
      }
    }

    // No thumbnail available
    return NextResponse.json({ error: 'No thumbnail available' }, { status: 404 });
  } catch (error) {
    console.error('[ThumbnailAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get thumbnail' }, { status: 500 });
  }
}
