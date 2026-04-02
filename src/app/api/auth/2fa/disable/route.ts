/**
 * 2FA Disable API (F024)
 *
 * POST /api/auth/2fa/disable - Disable 2FA on the user account.
 * Body: { code: string } - must provide valid TOTP code to confirm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { verifyTOTP, verifyBackupCode } from '@/lib/totp';

const disableSchema = z.object({
  code: z.string().min(1, 'Code is required'),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json();
    const { code } = disableSchema.parse(body);

    // Get user with 2FA data
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled' },
        { status: 400 }
      );
    }

    // Verify TOTP code or backup code
    const isTOTPValid = verifyTOTP(user.twoFactorSecret, code);
    const backupCodeIndex = !isTOTPValid ? verifyBackupCode(code, user.twoFactorBackupCodes) : -1;

    if (!isTOTPValid && backupCodeIndex === -1) {
      return NextResponse.json(
        { error: 'Invalid code. Please enter a valid authenticator or backup code.' },
        { status: 400 }
      );
    }

    // Disable 2FA and clear secret + backup codes
    await db.user.update({
      where: { id: session.userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      },
    });

    return NextResponse.json({
      disabled: true,
      message: 'Two-factor authentication has been disabled.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[2FA Disable] Error:', error);
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to disable 2FA' }, { status: 500 });
  }
}
