import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { rateLimiters } from '@/lib/middleware/rateLimit';
import { createServiceContext } from '@/services';
import {
  commitFolderImport,
  FolderImportError,
  previewFolderImport,
  type FolderImportFile,
} from '@/lib/rooms/folderImportService';
import { RateLimitError } from '@/lib/errors';
import { MAX_IMPORT_BYTES } from '@/lib/rooms/folderImport';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

function errorResponse(error: unknown) {
  if (error instanceof FolderImportError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status }
    );
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many upload requests' } },
      { status: 429, headers: { 'Retry-After': String(error.retryAfter) } }
    );
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'IMPORT_COLLISION',
          message: 'A folder or document was added while you were importing. Review and retry.',
        },
      },
      { status: 409 }
    );
  }
  console.error('[FolderImport] Request failed:', error);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'IMPORT_FAILED',
        message: 'Folder import failed. Nothing was added. Please retry.',
      },
    },
    { status: 500 }
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;
    const requestContext = getRequestContext(request);
    const ctx = createServiceContext({
      session,
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    if (request.headers.get('content-type')?.includes('application/json')) {
      const body: unknown = await request.json();
      if (!body || typeof body !== 'object') {
        throw new FolderImportError('IMPORT_VALIDATION_FAILED', 'Invalid preview request', 400);
      }
      const input = body as Record<string, unknown>;
      if (
        !Array.isArray(input['files']) ||
        (input['parentFolderId'] !== null &&
          input['parentFolderId'] !== undefined &&
          typeof input['parentFolderId'] !== 'string')
      ) {
        throw new FolderImportError('IMPORT_VALIDATION_FAILED', 'Invalid preview request', 400);
      }
      const files: FolderImportFile[] = input['files'].map((item: unknown) => {
        if (
          !item ||
          typeof item !== 'object' ||
          !('name' in item) ||
          !('size' in item) ||
          !('path' in item) ||
          typeof item.name !== 'string' ||
          typeof item.size !== 'number' ||
          !Number.isSafeInteger(item.size) ||
          typeof item.path !== 'string'
        ) {
          throw new FolderImportError('IMPORT_VALIDATION_FAILED', 'Invalid file manifest', 400);
        }
        return { file: { name: item.name, size: item.size, type: '' }, path: item.path };
      });
      const preview = await previewFolderImport(
        ctx,
        roomId,
        files,
        (input['parentFolderId'] as string | undefined) ?? null
      );
      return NextResponse.json({ success: true, preview });
    }

    await rateLimiters.uploadByUser(session.userId);
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES + 1024 * 1024) {
      throw new FolderImportError(
        'IMPORT_LIMIT_EXCEEDED',
        'Folder import request is too large',
        413
      );
    }
    const formData = await request.formData();
    const uploaded = formData.getAll('file');
    const paths = formData.getAll('path');
    const parentFolderId = formData.get('parentFolderId');
    if (
      uploaded.length !== paths.length ||
      uploaded.some((item) => !(item instanceof File)) ||
      paths.some((item) => typeof item !== 'string') ||
      (parentFolderId !== null && typeof parentFolderId !== 'string')
    ) {
      throw new FolderImportError('IMPORT_VALIDATION_FAILED', 'Files and paths must match', 400);
    }
    const files = uploaded.map((item, index) => ({
      file: item as File,
      path: paths[index] as string,
    }));
    const result = await commitFolderImport(ctx, roomId, files, parentFolderId as string | null);
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
