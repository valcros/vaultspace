/**
 * Resend Email Verification API
 *
 * POST /api/auth/resend-verification  { email }
 *
 * Recovery path for a self-service registrant who did not receive (or lost)
 * their verification email. Privacy-preserving: always returns the same neutral,
 * time-normalized response regardless of whether the email exists or is already
 * verified. A fresh token is issued WITHOUT invalidating any already-delivered
 * valid link (so an unauthenticated caller cannot kill a real recipient's link).
 */

import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { bootstrapDb as db } from '@/lib/db';
import { createEmailVerificationToken } from '@/lib/auth/emailVerificationToken';
import { sendEmailVerificationEmail } from '@/lib/auth/emailVerificationDelivery';
import { getRequestContext, rateLimiters } from '@/lib/middleware';
import { RateLimitError } from '@/lib/errors';

const resendSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const MINIMUM_RESPONSE_MS = 300;

function emailFingerprint(normalizedEmail: string): string {
  const secret = process.env['SESSION_SECRET'] || '';
  return createHmac('sha256', secret)
    .update(`vaultspace/email-verification-resend\0${normalizedEmail}`, 'utf8')
    .digest('hex');
}

async function neutralResponse(startedAt: number): Promise<NextResponse> {
  const remaining = MINIMUM_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  // Always the same shape — never reveal whether the account exists / is verified.
  return NextResponse.json({ status: 'verification_sent' }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { email } = resendSchema.parse(await request.json());
    const normalizedEmail = email.toLowerCase();
    const reqContext = getRequestContext(request);
    const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;

    // Rate-limit by email fingerprint and IP (fail-closed).
    await rateLimiters.emailVerificationResendByEmailFingerprint(emailFingerprint(normalizedEmail));
    if (ipAddress) {
      await rateLimiters.emailVerificationResendByIp(ipAddress);
    }

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, firstName: true, emailVerifiedAt: true },
    });

    // Only a pending (unverified) account gets a fresh token. Verified accounts
    // and unknown emails fall through to the identical neutral response.
    if (user && user.emailVerifiedAt === null) {
      const { publicToken, storedToken } = createEmailVerificationToken();
      // Do NOT invalidate prior unconsumed tokens — bounded concurrent tokens are
      // acceptable; the verify claim consumes one and the rest simply expire.
      await db.emailVerificationToken.create({
        data: {
          userId: user.id,
          token: storedToken,
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        },
      });
      // Fire-and-forget: do not await email-provider latency in the response
      // path — that latency occurs only for pending accounts and would leak
      // account existence via timing. Failures are logged.
      void sendEmailVerificationEmail({
        to: normalizedEmail,
        firstName: user.firstName,
        publicToken,
      }).catch((sendError) => {
        console.error('[ResendVerificationAPI] Verification email send failed:', sendError);
      });
    }

    return await neutralResponse(startedAt);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[ResendVerificationAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
