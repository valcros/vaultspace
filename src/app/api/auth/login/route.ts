/**
 * Login API (F004)
 *
 * POST /api/auth/login - Authenticate user with email/password
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { createSession } from '@/lib/auth';
import {
  generateTwoFactorChallengeToken,
  hashTwoFactorChallengeToken,
} from '@/lib/auth/twoFactorChallengeToken';
import {
  issueTenantTwoFactorChallenge,
  type IssuedTwoFactorChallenge,
} from '@/lib/auth/twoFactorChallengeRepository';
import { bootstrapRepository } from '@/lib/auth/bootstrapRepository';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { withOrgContext } from '@/lib/db';
import { getRequestContext, rateLimiters, setSessionCookie } from '@/lib/middleware';
import { RateLimitError } from '@/lib/errors';
import { SESSION_CONFIG } from '@/lib/constants';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const body = await request.json();
    const { email, password, rememberMe } = loginSchema.parse(body);
    const reqContext = getRequestContext(request);
    requestId = reqContext.requestId;
    const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
    const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

    // Throttle credential stuffing / brute force BEFORE any account lookup or
    // bcrypt work (SEC-010/011). Keyed by email + client IP; fail closed.
    try {
      await Promise.all([
        rateLimiters.loginByEmail(email.toLowerCase()),
        rateLimiters.loginByIp(reqContext.ipAddress || 'unknown'),
      ]);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          { error: 'Too many login attempts. Please try again later.' },
          { status: 429 }
        );
      }
      console.error(
        JSON.stringify({
          component: 'login-api',
          outcome: 'rate-limiter-unavailable',
          reasonCode: 'LOGIN_RATE_LIMITER_UNAVAILABLE',
          requestId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      );
      return NextResponse.json({ error: 'Failed to sign in' }, { status: 503 });
    }

    // Resolve the pre-tenant login candidate through the exact, reviewed
    // bootstrap function. A null result is a neutral denial. Errors fail
    // closed; this route never falls back to the admin Prisma client.
    const candidate = await bootstrapRepository.findLoginCandidate(email);

    if (!candidate) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, candidate.passwordHash);
    if (!passwordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if 2FA is enabled - if so, return a temp token instead of creating a session
    if (candidate.twoFactorEnabled) {
      const tempToken = generateTwoFactorChallengeToken();
      const tokenHash = hashTwoFactorChallengeToken(tempToken);
      if (!tokenHash) {
        throw new Error('TWO_FACTOR_CHALLENGE_TOKEN_INVALID');
      }
      let challenge: IssuedTwoFactorChallenge | null;
      try {
        challenge = await issueTenantTwoFactorChallenge({
          userId: candidate.userId,
          organizationId: candidate.organizationId,
          tokenHash,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            component: 'login-api',
            outcome: 'mfa-challenge-issue-failed',
            reasonCode:
              error instanceof Error && error.message === 'TWO_FACTOR_CHALLENGE_ISSUE_ROW_INVALID'
                ? 'MFA_CHALLENGE_ISSUER_INVALID_RESULT'
                : 'MFA_CHALLENGE_ISSUER_EXCEPTION',
            requestId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          })
        );
        return NextResponse.json({ error: 'Failed to sign in' }, { status: 503 });
      }
      if (!challenge) {
        console.error(
          JSON.stringify({
            component: 'login-api',
            outcome: 'mfa-challenge-issue-empty',
            reasonCode: 'MFA_CHALLENGE_ISSUER_EMPTY',
            requestId,
          })
        );
        return NextResponse.json({ error: 'Failed to sign in' }, { status: 503 });
      }
      return NextResponse.json({
        requiresTwoFactor: true,
        tempToken,
      });
    }

    const sessionDuration = rememberMe
      ? SESSION_CONFIG.EXTENDED_DURATION_DAYS * 24 * 60 * 60 * 1000
      : SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration);

    // Create the session and stamp the lastLoginAt atomically inside an org
    // context so RLS policies on the users table can verify membership.
    const { session: authSession, token: sessionToken } = await withOrgContext(
      candidate.organizationId,
      async (tx) => {
        const createdSession = await createSession(
          candidate.userId,
          candidate.organizationId,
          { expiresAt, ipAddress, userAgent },
          tx
        );

        await tx.user.update({
          where: { id: candidate.userId },
          data: { lastLoginAt: new Date() },
        });

        return createdSession;
      }
    );

    // Set session cookie
    await setSessionCookie(sessionToken, expiresAt);

    await captureAccessAudit({
      organizationId: candidate.organizationId,
      eventType: 'USER_LOGIN',
      actorType: candidate.organizationRole === 'ADMIN' ? 'ADMIN' : 'VIEWER',
      actorId: candidate.userId,
      actorEmail: candidate.email,
      requestId: reqContext.requestId,
      description: 'User signed in',
      metadata: {
        authSessionId: authSession.id,
        authenticationMethod: 'PASSWORD',
      },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      user: {
        id: candidate.userId,
        email: candidate.email,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      },
      organization: {
        id: candidate.organizationId,
        name: candidate.organizationName,
        slug: candidate.organizationSlug,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error(
      JSON.stringify({
        component: 'login-api',
        outcome: 'failed',
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Failed to sign in' }, { status: 500 });
  }
}
