import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '@/lib/auth/sameOrigin';

import { requireAuth } from '@/lib/middleware';
import { AuthorizationError, RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters } from '@/lib/middleware';
import {
  enterSysopMode,
  exitSysopMode,
  getActiveSysopSession,
  requireSysopEligibility,
} from '@/lib/sysop/platformSession';

export const dynamic = 'force-dynamic';

const enterSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter a six-digit verification code'),
  reason: z.enum(['PLATFORM_MAINTENANCE', 'SUPPORT', 'INCIDENT']),
});

export async function GET() {
  try {
    const session = await requireAuth();
    await requireSysopEligibility(session);
    const platform = await getActiveSysopSession(session);
    return NextResponse.json({ active: Boolean(platform), expiresAt: platform?.expiresAt ?? null });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    const { code, reason } = enterSchema.parse(await request.json());
    const context = getRequestContext(request);
    await Promise.all([
      rateLimiters.loginByEmail(`sysop:${session.userId}`),
      rateLimiters.loginByIp(context.ipAddress),
    ]);
    const expiresAt = await enterSysopMode(session, code, reason, context.requestId);
    return NextResponse.json({ active: true, expiresAt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message }, { status: 400 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Unable to enter SysOp mode' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    await exitSysopMode(session, getRequestContext(request).requestId);
    return NextResponse.json({ active: false });
  } catch {
    return NextResponse.json({ error: 'Unable to exit SysOp mode' }, { status: 503 });
  }
}
