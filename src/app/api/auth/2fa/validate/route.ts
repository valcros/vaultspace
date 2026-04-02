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
import { z } from 'zod';
import { createHmac } from 'crypto';

import { db } from '@/lib/db';
import { setSessionCookie } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';
import { verifyTOTP, verifyBackupCode } from '@/lib/totp';
import { randomBytes } from 'crypto';

const validateSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  tempToken: z.string().min(1, 'Temporary token is required'),
});

/**
 * Verify the temp token and extract the userId.
 * Temp token format: userId:timestamp:hmac
 */
function verifyTempToken(tempToken: string): { userId: string } | null {
  const secret =
    process.env['SESSION_SECRET'] || process.env['NEXTAUTH_SECRET'] || 'vaultspace-2fa-temp-secret';
  const parts = tempToken.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const [userId, timestamp, signature] = parts;
  if (!userId || !timestamp || !signature) {
    return null;
  }

  // Check expiry (5 minutes)
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
    return null;
  }

  // Verify HMAC signature
  const expected = createHmac('sha256', secret).update(`${userId}:${timestamp}`).digest('hex');

  if (signature !== expected) {
    return null;
  }

  return { userId };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, tempToken } = validateSchema.parse(body);

    // Verify temp token
    const tokenData = verifyTempToken(tempToken);
    if (!tokenData) {
      return NextResponse.json(
        { error: 'Invalid or expired temporary token. Please log in again.' },
        { status: 401 }
      );
    }

    // Get user with 2FA data
    const user = await db.user.findUnique({
      where: { id: tokenData.userId },
      include: {
        organizations: {
          where: { isActive: true },
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
          orderBy: { createdAt: 'asc' },
          take: 1,
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

    // If a backup code was used, remove it (one-time use)
    if (backupCodeIndex !== -1) {
      const updatedCodes = [...user.twoFactorBackupCodes];
      updatedCodes.splice(backupCodeIndex, 1);
      await db.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: updatedCodes },
      });
    }

    // Get default organization
    const userOrg = user.organizations[0];
    if (!userOrg || !userOrg.organization.isActive) {
      return NextResponse.json({ error: 'No active organization found' }, { status: 403 });
    }

    // Create full session (mirrors login route logic)
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionDuration = SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration);

    await db.session.create({
      data: {
        userId: user.id,
        organizationId: userOrg.organization.id,
        token: sessionToken,
        expiresAt,
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
      },
    });

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Set session cookie
    await setSessionCookie(sessionToken, expiresAt);

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
