import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createAccountLink,
  listAccountLinks,
  removeAccountLink,
} from '@/lib/auth/accountSwitching';
import { isSameOriginRequest } from '@/lib/auth/sameOrigin';
import { AuthenticationError, AuthorizationError, RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters, requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

const proofSchema = z.object({
  primaryPassword: z.string().min(1).max(1024),
  primaryCode: z.string().regex(/^\d{6}$/),
});
const linkSchema = proofSchema.extend({
  secondaryEmail: z.string().email().max(255),
  secondaryPassword: z.string().min(1).max(1024),
  secondaryCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const unlinkSchema = proofSchema.extend({ linkId: z.string().min(1).max(255) });

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.errors[0]?.message ?? 'Invalid input' },
      { status: 400 }
    );
  }
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }
  return NextResponse.json({ error: 'Account operation unavailable' }, { status: 503 });
}

export async function GET() {
  try {
    const session = await requireAuth();
    return NextResponse.json(await listAccountLinks(session), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    const context = getRequestContext(request);
    const input = linkSchema.parse(await request.json());
    await Promise.all([
      rateLimiters.loginByEmail(`link:${session.userId}`),
      rateLimiters.loginByEmail(input.secondaryEmail.trim().toLowerCase()),
      rateLimiters.loginByIp(context.ipAddress),
    ]);
    const link = await createAccountLink(session, input, context.requestId);
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Request origin denied' }, { status: 403 });
  }
  try {
    const session = await requireAuth();
    const context = getRequestContext(request);
    await Promise.all([
      rateLimiters.loginByEmail(`unlink:${session.userId}`),
      rateLimiters.loginByIp(context.ipAddress),
    ]);
    const input = unlinkSchema.parse(await request.json());
    await removeAccountLink(
      session,
      input.linkId,
      input.primaryPassword,
      input.primaryCode,
      context.requestId
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
