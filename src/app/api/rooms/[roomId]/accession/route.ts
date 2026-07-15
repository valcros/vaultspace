/**
 * Accession Numbering API
 *
 * POST /api/rooms/:roomId/accession - Enable accession numbering for a room and
 * optionally backfill existing documents with immutable citation IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin, getRequestContext } from '@/lib/middleware';
import { createServiceContext, roomService } from '@/services';
import { AppError, formatErrorResponse } from '@/lib/errors';
import { HTTP_STATUS } from '@/lib/constants';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const bodySchema = z.object({
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,16}$/, 'Prefix must be 1-16 letters or digits')
    .optional(),
  backfill: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAdmin();
    const { roomId } = await context.params;
    const reqContext = getRequestContext(request);

    const parsed = bodySchema.parse(await request.json().catch(() => ({})));

    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const result = await roomService.enableAccessionNumbering(ctx, roomId, {
      prefix: parsed.prefix,
      backfill: parsed.backfill,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('[AccessionAPI] POST error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
