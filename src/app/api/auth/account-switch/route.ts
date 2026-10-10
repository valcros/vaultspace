import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { stopAccountSwitching, switchAccount } from '@/lib/auth/accountSwitching';
import { isSameOriginRequest } from '@/lib/auth/sameOrigin';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { assertRateLimit, getRequestContext, requireAuth } from '@/lib/middleware';
import { RateLimitError } from '@/lib/errors';

const switchSchema = z.object({ targetUserId: z.string().min(1).max(255) });

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    await assertRateLimit(session.userId, {
      limit: 20,
      windowSeconds: 60,
      prefix: 'account-switch',
    });
    const { targetUserId } = switchSchema.parse(await request.json());
    const account = await switchAccount(
      session,
      targetUserId,
      getRequestContext(request).requestId
    );
    return NextResponse.json({ success: true, account });
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
      return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Account switching unavailable' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    await stopAccountSwitching(session, getRequestContext(request).requestId);
    return NextResponse.json({ switchingActive: false });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Could not end account switching' }, { status: 503 });
  }
}
