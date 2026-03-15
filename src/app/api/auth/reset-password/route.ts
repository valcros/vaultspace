/**
 * Reset Password API (F004)
 *
 * POST /api/auth/reset-password - Reset password with token
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
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
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    // Verify the user is active
    const user = await db.user.findUnique({
      where: { id: resetToken.userId },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update password and mark token as used
    await db.$transaction([
      db.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      db.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all other reset tokens for this user
      db.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: new Date() },
      }),
      // Optionally: invalidate all existing sessions for security
      db.session.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[ResetPasswordAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
