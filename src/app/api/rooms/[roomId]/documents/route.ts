/**
 * Document Upload API Route
 *
 * POST /api/rooms/:roomId/documents - Upload documents to a room
 * GET /api/rooms/:roomId/documents - List documents in a room
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { createServiceContext, documentService } from '@/services';
import { AppError, formatErrorResponse, NotFoundError, RateLimitError } from '@/lib/errors';
import { UPLOAD_CONFIG, HTTP_STATUS } from '@/lib/constants';
import { rateLimiters } from '@/lib/middleware/rateLimit';
import { getProviders } from '@/providers';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

// Allow large file uploads (default is 4MB in Next.js)
export const maxDuration = 60; // seconds

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * POST /api/rooms/:roomId/documents
 * Upload one or more documents to a room
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;
    const reqContext = getRequestContext(request);

    // Rate limiting for uploads (throws RateLimitError if exceeded)
    try {
      await rateLimiters.uploadByUser(session.userId);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many upload requests',
            },
          },
          {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            headers: {
              'Retry-After': String(error.retryAfter),
            },
          }
        );
      }
      throw error;
    }

    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll('file') as File[];
    const folderId = formData.get('folderId') as string | null;
    const tagsRaw = formData.get('tags') as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'At least one file is required',
          },
        },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Parse tags
    let tags: string[] | undefined;
    if (tagsRaw) {
      try {
        tags = JSON.parse(tagsRaw);
      } catch {
        tags = tagsRaw.split(',').map((t) => t.trim());
      }
    }

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    // Process each file
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file size
        if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES) {
          errors.push({
            filename: file.name,
            error: `File exceeds maximum size of ${UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
          });
          continue;
        }

        // Read file data
        const buffer = Buffer.from(await file.arrayBuffer());

        // Upload via service
        const doc = await documentService.upload(ctx, {
          roomId,
          folderId: folderId || undefined,
          file: {
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            data: buffer,
          },
          tags,
        });

        results.push({
          id: doc.id,
          name: doc.name,
          status: doc.status,
          scanStatus: doc.latestVersion?.scanStatus ?? 'PENDING',
          previewStatus: doc.latestVersion?.previewStatus ?? 'PENDING',
          uploadedAt: doc.createdAt.toISOString(),
          fileSize: Number(doc.fileSize),
          mimeType: doc.mimeType,
        });

        // Queue upload notification job (async via job queue per architecture)
        const providers = getProviders();
        providers.job
          .addJob('email', 'notify-document-uploaded', {
            organizationId: session.organizationId,
            roomId,
            documentId: doc.id,
            uploaderId: session.userId,
          })
          .catch((err) => console.error('[DocumentAPI] Failed to queue notification:', err));
      } catch (error) {
        errors.push({
          filename: file.name,
          error: error instanceof AppError ? error.message : 'Upload failed',
        });
      }
    }

    return NextResponse.json(
      {
        success: results.length > 0,
        documents: results,
        ...(errors.length > 0 && { errors }),
      },
      { status: results.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Document upload error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

/**
 * GET /api/rooms/:roomId/documents
 * List documents in a room
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;
    const reqContext = getRequestContext(request);

    const searchParams = request.nextUrl.searchParams;
    const folderId = searchParams.get('folderId') || undefined;
    const status =
      (searchParams.get('status') as 'ACTIVE' | 'ARCHIVED' | 'DELETED' | null) ?? 'ACTIVE';
    const search = searchParams.get('search') || undefined;
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const result = await documentService.list(ctx, {
      roomId,
      folderId,
      status,
      search,
      offset,
      limit,
    });

    // Format response
    const documents = result.items.map((doc) => ({
      id: doc.id,
      name: doc.name,
      status: doc.status,
      scanStatus: doc.latestVersion?.scanStatus ?? null,
      previewStatus: doc.latestVersion?.previewStatus ?? null,
      mimeType: doc.mimeType,
      size: Number(doc.fileSize),
      tags: doc.tags,
      folderId: doc.folderId,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      documents,
      pagination: {
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
        },
        { status: HTTP_STATUS.NOT_FOUND }
      );
    }
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Document list error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
