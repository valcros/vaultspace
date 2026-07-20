/**
 * Reset Password API (F004)
 *
 * POST /api/auth/reset-password - Reset password with token
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { clearSessionCache, deactivateAllUserSessionsInTx } from '@/lib/auth';
import { bootstrapDb as db } from '@/lib/db';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Find valid reset token
    const resetToken = await db.passwordResetToken.findFirst({
      where: {
        token,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!resetToken) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    // Verify the user is active
    const user = await db.user.findUnique({
      where: { id: resetToken.userId },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    // Hash new password. The findFirst above already rejected invalid/used/
    // expired tokens, so the only case where this hash is "wasted" is a genuine
    // race where the token is consumed between validation and the claim below —
    // near-never, and cheaper than splitting consume + password-update across
    // two transactions.
    const passwordHash = await bcrypt.hash(password, 12);

    // Consume the token, set the password, and deactivate sessions in ONE
    // transaction. The first statement CLAIMS the token conditionally: it only
    // succeeds while the token is still unused and unexpired, so a token
    // invalidated after the findFirst above (e.g. by an email change that
    // consumes outstanding tokens, or a concurrent reset) can no longer reset
    // the password. With a unique id the claim matches 0 or 1 row; anything but
    // 1 means we lost the race and the transaction commits without touching the
    // password.
    const sessionTokens = await db.$transaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (claim.count !== 1) {
        return null;
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      // Invalidate any other outstanding reset tokens for this user.
      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });

      return deactivateAllUserSessionsInTx(tx, resetToken.userId);
    });

    if (sessionTokens === null) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    await clearSessionCache(sessionTokens);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[ResetPasswordAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
