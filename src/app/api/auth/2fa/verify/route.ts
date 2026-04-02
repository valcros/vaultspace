/**
 * 2FA Verify API (F024)
 *
 * POST /api/auth/2fa/verify - Verify a TOTP code to enable 2FA.
 * Body: { code: string }
 * On success, enables 2FA and returns backup codes (one-time display).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { verifyTOTP, generateBackupCodes, hashBackupCode } from '@/lib/totp';

const verifySchema = z.object({
  code: z
    .string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json();
    const { code } = verifySchema.parse(body);

    // Get user with secret
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled' },
        { status: 400 }
      );
    }

    if (!user.twoFactorSecret) {
      return NextResponse.json(
        { error: 'No 2FA setup in progress. Call /api/auth/2fa/setup first.' },
        { status: 400 }
      );
    }

    // Verify the TOTP code
    const isValid = verifyTOTP(user.twoFactorSecret, code);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid verification code. Please try again.' },
        { status: 400 }
      );
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(hashBackupCode);

    // Enable 2FA and store hashed backup codes
    await db.user.update({
      where: { id: session.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: hashedBackupCodes,
      },
    });

    return NextResponse.json({
      enabled: true,
      backupCodes,
      message:
        'Two-factor authentication has been enabled. Save your backup codes in a safe place. They will not be shown again.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[2FA Verify] Error:', error);
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to verify 2FA code' }, { status: 500 });
  }
}
