/**
 * Login API (F004)
 *
 * POST /api/auth/login - Authenticate user with email/password
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { generateTwoFactorTempToken } from '@/lib/auth/twoFactorTempToken';
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
  try {
    const body = await request.json();
    const { email, password, rememberMe } = loginSchema.parse(body);
    const reqContext = getRequestContext(request);
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
      const tempToken = generateTwoFactorTempToken(candidate.userId);
      return NextResponse.json({
        requiresTwoFactor: true,
        tempToken,
      });
    }

    // Generate session token
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionDuration = rememberMe
      ? SESSION_CONFIG.EXTENDED_DURATION_DAYS * 24 * 60 * 60 * 1000
      : SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration);

    // Create the session and stamp the lastLoginAt atomically inside an org
    // context so RLS policies on the users table can verify membership.
    const authSession = await withOrgContext(candidate.organizationId, async (tx) => {
      const createdSession = await tx.session.create({
        data: {
          userId: candidate.userId,
          organizationId: candidate.organizationId,
          token: sessionToken,
          expiresAt,
          ipAddress,
          userAgent,
        },
      });

      await tx.user.update({
        where: { id: candidate.userId },
        data: { lastLoginAt: new Date() },
      });

      return createdSession;
    });

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
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Failed to sign in' }, { status: 500 });
  }
}
