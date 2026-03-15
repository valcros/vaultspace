/**
 * Storage Download API
 *
 * GET /api/storage/download - Download file with signed URL validation
 *
 * Query params:
 *   bucket - Storage bucket name
 *   key - File key/path
 *   expires - Expiration timestamp
 *   sig - Signature for validation
 */

import { NextRequest, NextResponse } from 'next/server';

import { getProviders } from '@/providers';

// This route uses request.url for query params, so it must be dynamic
export const dynamic = 'force-dynamic';
import { LocalStorageProvider } from '@/providers/storage/LocalStorageProvider';

// MIME type mapping for common file types
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function getMimeType(key: string): string {
  const ext = key.substring(key.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bucket = searchParams.get('bucket');
    const key = searchParams.get('key');
    const expires = searchParams.get('expires');
    const sig = searchParams.get('sig');

    // Validate required params
    if (!bucket || !key || !expires || !sig) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get storage provider
    const providers = getProviders();
    const storage = providers.storage;

    // Validate signed URL (only for LocalStorageProvider)
    if (storage instanceof LocalStorageProvider) {
      const isValid = storage.validateSignedUrl(bucket, key, expires, sig);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid or expired download link' },
          { status: 403 }
        );
      }
    }

    // Check if file exists
    const exists = await storage.exists(bucket, key);
    if (!exists) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Get file content
    const data = await storage.get(bucket, key);
    const mimeType = getMimeType(key);

    // Determine if this should be inline (preview) or attachment (download)
    const disposition = searchParams.get('disposition') || 'inline';
    const filename = key.split('/').pop() || 'file';

    // Return file with appropriate headers
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': data.length.toString(),
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'private, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('[StorageDownloadAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    );
  }
}
