/**
 * 2FA Validate API (F024)
 *
 * POST /api/auth/2fa/validate - Validate TOTP during login flow.
 * Body: { code: string, tempToken: string }
 *
 * Called after initial password auth when 2FA is enabled.
 * Validates the TOTP code (or backup code), then creates a full session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { db, withOrgContext } from '@/lib/db';
import { createMfaVerifiedSession } from '@/lib/auth';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { resolveTenantTwoFactorChallenge } from '@/lib/auth/twoFactorChallengeRepository';
import { getRequestContext, rateLimiters, setSessionCookie } from '@/lib/middleware';
import { RateLimitError } from '@/lib/errors';
import { SESSION_CONFIG } from '@/lib/constants';
import { verifyTOTP, verifyBackupCode } from '@/lib/totp';

const validateSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  tempToken: z.string().min(1, 'Temporary token is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, tempToken } = validateSchema.parse(body);
    const reqContext = getRequestContext(request);
    const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
    const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

    // Verify temp token
    const tokenData = await resolveTenantTwoFactorChallenge(tempToken);
    if (!tokenData) {
      return NextResponse.json(
        { error: 'Invalid or expired temporary token. Please log in again.' },
        { status: 401 }
      );
    }

    // Throttle 2FA code guessing per user + IP. The temp token is reusable for
    // its window, so cap online TOTP/backup-code attempts. Fail closed.
    try {
      await Promise.all([
        rateLimiters.loginByEmail(`2fa:${tokenData.userId}`),
        rateLimiters.loginByIp(reqContext.ipAddress || 'unknown'),
      ]);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          { error: 'Too many attempts. Please log in again.' },
          { status: 429 }
        );
      }
      console.error('[2FA Validate] Rate limiter unavailable:', error);
      return NextResponse.json({ error: 'Failed to validate 2FA code' }, { status: 503 });
    }

    // Get user with 2FA data
    const user = await db.user.findUnique({
      where: { id: tokenData.userId },
      include: {
        organizations: {
          where: { isActive: true, organizationId: tokenData.organizationId },
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json({ error: '2FA is not enabled for this account' }, { status: 400 });
    }

    // Verify TOTP code or backup code
    const isTOTPValid = verifyTOTP(user.twoFactorSecret, code);
    const backupCodeIndex = !isTOTPValid ? verifyBackupCode(code, user.twoFactorBackupCodes) : -1;

    if (!isTOTPValid && backupCodeIndex === -1) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    // Get default organization
    const userOrg = user.organizations.find(
      (membership) => membership.organization.id === tokenData.organizationId
    );
    if (!userOrg || !userOrg.organization.isActive) {
      return NextResponse.json({ error: 'No active organization found' }, { status: 403 });
    }

    // Create full session (mirrors login route logic)
    const sessionDuration = SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration);

    // The session, one-time backup-code removal, and last-login stamp are one
    // transaction. A denied/failed session issue must not burn a backup code.
    const { session: authSession, token: sessionToken } = await withOrgContext(
      userOrg.organization.id,
      async (tx) => {
        const createdSession = await createMfaVerifiedSession(
          user.id,
          userOrg.organization.id,
          { expiresAt, ipAddress, userAgent, mfaChallengeToken: tempToken },
          tx
        );

        if (backupCodeIndex !== -1) {
          // Lock and re-read the authoritative array inside this transaction.
          // This serializes two distinct backup-code uses and prevents a stale
          // array write from reintroducing another code that was just consumed.
          const lockedRows = await tx.$queryRaw<Array<{ twoFactorBackupCodes: string[] }>>(
            Prisma.sql`
            SELECT "twoFactorBackupCodes"
            FROM public.users
            WHERE id = ${user.id}::text
            FOR UPDATE
          `
          );
          const lockedCodes = lockedRows[0]?.twoFactorBackupCodes;
          const lockedBackupCodeIndex = lockedCodes ? verifyBackupCode(code, lockedCodes) : -1;
          if (!lockedCodes || lockedBackupCodeIndex === -1) {
            throw new Error('BACKUP_CODE_ALREADY_CONSUMED');
          }
          const updatedCodes = [...lockedCodes];
          updatedCodes.splice(lockedBackupCodeIndex, 1);
          await tx.user.update({
            where: { id: user.id },
            data: { twoFactorBackupCodes: updatedCodes },
          });
        }

        await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        return createdSession;
      }
    );

    // Set session cookie
    await setSessionCookie(sessionToken, expiresAt);

    await captureAccessAudit({
      organizationId: userOrg.organization.id,
      eventType: 'USER_LOGIN',
      actorType: userOrg.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
      actorId: user.id,
      actorEmail: user.email,
      requestId: reqContext.requestId,
      description: 'User signed in with two-factor authentication',
      metadata: {
        authSessionId: authSession.id,
        authenticationMethod: backupCodeIndex === -1 ? 'TOTP' : 'BACKUP_CODE',
      },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      organization: {
        id: userOrg.organization.id,
        name: userOrg.organization.name,
        slug: userOrg.organization.slug,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[2FA Validate] Error:', error);
    return NextResponse.json({ error: 'Failed to validate 2FA code' }, { status: 500 });
  }
}
