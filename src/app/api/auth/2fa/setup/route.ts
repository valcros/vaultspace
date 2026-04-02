/**
 * 2FA Setup API (F024)
 *
 * POST /api/auth/2fa/setup - Generate a new TOTP secret for 2FA setup.
 * Returns the otpauth:// URI and raw secret for manual entry.
 * Stores the secret temporarily (2FA not enabled until verified).
 */

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { generateTOTPSecret, buildOTPAuthURI } from '@/lib/totp';

export async function POST() {
  try {
    const session = await requireAuth();

    // Check if 2FA is already enabled
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabled: true, email: true },
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

    // Generate a new TOTP secret
    const secret = generateTOTPSecret();

    // Store the secret temporarily (not enabled yet, user must verify first)
    await db.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: secret },
    });

    // Build the otpauth URI for authenticator apps
    const otpauthUri = buildOTPAuthURI(secret, user.email);

    return NextResponse.json({
      secret,
      otpauthUri,
      message:
        'Scan the QR code or enter the secret manually in your authenticator app, then verify with a code.',
    });
  } catch (error) {
    console.error('[2FA Setup] Error:', error);
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to set up 2FA' }, { status: 500 });
  }
}
