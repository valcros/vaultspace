/**
 * Change Password API
 *
 * POST /api/auth/change-password - Change the signed-in user's password.
 * Requires the current password. Invalidates the user's other sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { isAuthenticationError } from '@/lib/errors';
import { withOrgContext } from '@/lib/db';
import { hashPassword, verifyPassword, validatePassword } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(1, 'New password is required'),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { currentPassword, newPassword } = schema.parse(await request.json());

    const user = await withOrgContext(session.organizationId, async (tx) => {
      return tx.user.findUnique({
        where: { id: session.userId },
        select: { id: true, passwordHash: true },
      });
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const currentOk = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentOk) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    const check = validatePassword(newPassword);
    if (!check.valid) {
      return NextResponse.json(
        { error: check.errors[0] ?? 'Invalid new password' },
        { status: 400 }
      );
    }

    const sameAsOld = await verifyPassword(newPassword, user.passwordHash);
    if (sameAsOld) {
      return NextResponse.json(
        { error: 'New password must be different from the current password' },
        { status: 400 }
      );
    }

    const newHash = await hashPassword(newPassword);
    await withOrgContext(session.organizationId, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

      // Security: invalidate the user's other active sessions, keep the current one.
      await tx.session.updateMany({
        where: {
          userId: user.id,
          id: { not: session.sessionId },
          isActive: true,
        },
        data: { isActive: false },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[ChangePasswordAPI] error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
