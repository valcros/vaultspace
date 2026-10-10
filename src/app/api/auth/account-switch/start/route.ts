import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { startAccountSwitching } from '@/lib/auth/accountSwitching';
import { isSameOriginRequest } from '@/lib/auth/sameOrigin';
import { AuthenticationError, AuthorizationError, RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters, requireAuth } from '@/lib/middleware';

const schema = z.object({
  password: z.string().min(1).max(1024),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    const context = getRequestContext(request);
    await Promise.all([
      rateLimiters.loginByEmail(`switch-start:${session.userId}`),
      rateLimiters.loginByIp(context.ipAddress),
    ]);
    const { password, code } = schema.parse(await request.json());
    const expiresAt = await startAccountSwitching(session, password, code, context.requestId);
    return NextResponse.json({ switchingActive: true, expiresAt });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid proof' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Account switching unavailable' }, { status: 503 });
  }
}
