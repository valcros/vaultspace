/**
 * Email Verification API
 *
 * POST /api/auth/verify-email  { token }
 *
 * Consumes a single-use verification token and, on first success, creates the
 * self-service registrant's organization + ADMIN membership, marks the user
 * verified, and signs them in. The token claim and the org creation happen in
 * one transaction so a failure cannot leave a consumed token with no org.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createSession } from '@/lib/auth';
import { bootstrapDb as db } from '@/lib/db';
import { resolveStoredToken } from '@/lib/auth/emailVerificationToken';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { getRequestContext, setSessionCookie } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';

const verifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export async function POST(request: NextRequest) {
  try {
    const { token } = verifySchema.parse(await request.json());
    const digest = resolveStoredToken(token);
    if (!digest) {
      return NextResponse.json(
        { error: 'This verification link is invalid or has expired. Request a new one.' },
        { status: 400 }
      );
    }

    const reqContext = getRequestContext(request);
    const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
    const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;
    const now = new Date();

    const outcome = await db.$transaction(async (tx) => {
      const tokenRow = await tx.emailVerificationToken.findFirst({
        where: { token: digest },
        select: { userId: true },
      });
      if (!tokenRow) {
        return { status: 'invalid' as const };
      }

      // Serialize ALL verification for this user, not just this token. A user can
      // hold several valid tokens (register + resends); without a user-level lock
      // two concurrent verifies with different tokens could each claim their own
      // token and both create an organization. This advisory xact lock makes the
      // verified-check-then-provision sequence atomic per user (mirrors the
      // password-reset user lock).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(
        hashtextextended(${`vaultspace/email-verification/user/${tokenRow.userId}`}, 0)
      )`;

      const user = await tx.user.findUnique({
        where: { id: tokenRow.userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          emailVerifiedAt: true,
        },
      });
      if (!user) {
        return { status: 'invalid' as const };
      }

      // Already verified (through this or another token) — idempotent success.
      // Checked AFTER the lock, so a racing verify sees the committed result.
      if (user.emailVerifiedAt) {
        return { status: 'already_verified' as const };
      }

      // Atomic single-use claim of this specific token.
      const claim = await tx.emailVerificationToken.updateMany({
        where: { token: digest, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      // Claim did not land (already used or expired) and the user is not verified.
      if (claim.count !== 1) {
        return { status: 'expired' as const };
      }

      // Fresh claim: create the organization + ADMIN membership, mark verified.
      const slug = `org-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const organization = await tx.organization.create({
        data: { name: `${user.firstName}'s Organization`, slug, isActive: true },
      });
      await tx.userOrganization.create({
        data: { userId: user.id, organizationId: organization.id, role: 'ADMIN', isActive: true },
      });
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });

      return { status: 'verified' as const, user, organization };
    });

    if (outcome.status === 'invalid' || outcome.status === 'expired') {
      return NextResponse.json(
        { error: 'This verification link is invalid or has expired. Request a new one.' },
        { status: 400 }
      );
    }

    if (outcome.status === 'already_verified') {
      return NextResponse.json({ status: 'already_verified' }, { status: 200 });
    }

    // Verified for the first time — sign the new owner in.
    const expiresAt = new Date(
      Date.now() + SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000
    );
    const { session: authSession, token: sessionToken } = await createSession(
      outcome.user.id,
      outcome.organization.id,
      { expiresAt, ipAddress, userAgent }
    );
    await setSessionCookie(sessionToken, expiresAt);

    await captureAccessAudit({
      organizationId: outcome.organization.id,
      eventType: 'USER_LOGIN',
      actorType: 'ADMIN',
      actorId: outcome.user.id,
      actorEmail: outcome.user.email,
      requestId: reqContext.requestId,
      description: 'Email verified; organization created and signed in',
      metadata: { authSessionId: authSession.id, authenticationMethod: 'EMAIL_VERIFICATION' },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      status: 'verified',
      user: {
        id: outcome.user.id,
        email: outcome.user.email,
        firstName: outcome.user.firstName,
        lastName: outcome.user.lastName,
      },
      organization: {
        id: outcome.organization.id,
        name: outcome.organization.name,
        slug: outcome.organization.slug,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[VerifyEmailAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to verify email' }, { status: 500 });
  }
}
