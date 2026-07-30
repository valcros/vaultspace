/**
 * Reset Password API (F004)
 *
 * POST /api/auth/reset-password - Reset password with token
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { clearSessionCache, deactivateAllUserSessionsInTx } from '@/lib/auth';
import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { bootstrapDb as db } from '@/lib/db';
import { getRequestContext } from '@/lib/middleware';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  const reqContext = getRequestContext(request);
  const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
  const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

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
      console.warn(
        JSON.stringify({
          component: 'reset-password',
          event: 'token_validation',
          outcome: 'rejected',
          requestId: reqContext.requestId,
          errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        })
      );
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    // Verify the user is active
    const user = await db.user.findUnique({
      where: { id: resetToken.userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        organizations: {
          where: { isActive: true, organization: { isActive: true } },
          select: { role: true, organizationId: true },
        },
      },
    });

    // Account-global password changes must have at least one active tenant in
    // which the completion can be audited. This also blocks legacy tokens or
    // tokens minted before a user's final membership was deactivated.
    if (!user || !user.isActive || user.organizations.length === 0) {
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
      // Use the same account lock as every issuance path. This prevents an old
      // token redemption and replacement-token issuance from interleaving
      // their token claims in opposite lock order.
      await tx.$queryRaw`
        SELECT 1 FROM users
        WHERE id = ${resetToken.userId}
        FOR UPDATE`;

      await tx.$queryRaw`
        SELECT 1
        FROM user_organizations uo
        JOIN organizations o ON o.id = uo."organizationId"
        WHERE uo."userId" = ${resetToken.userId}
        FOR UPDATE OF uo, o`;

      // Re-read account and membership eligibility under the locks. If a
      // concurrent deactivation won before us, no token or password mutation
      // occurs.
      const lockedUser = await tx.user.findUnique({
        where: { id: resetToken.userId },
        select: {
          id: true,
          email: true,
          isActive: true,
          organizations: {
            where: { isActive: true, organization: { isActive: true } },
            select: { role: true, organizationId: true },
          },
        },
      });

      if (!lockedUser || !lockedUser.isActive || lockedUser.organizations.length === 0) {
        return null;
      }

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

      const sessionTokens = await deactivateAllUserSessionsInTx(tx, resetToken.userId);

      await Promise.all(
        lockedUser.organizations.map((membership) =>
          createSecurityAuditEvent(tx, {
            organizationId: membership.organizationId,
            eventType: 'USER_PASSWORD_RESET',
            actorType: membership.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
            actorId: lockedUser.id,
            actorEmail: lockedUser.email,
            requestId: reqContext.requestId,
            correlationId: resetToken.id,
            description: 'User completed a password reset',
            metadata: {
              outcome: 'success',
              stage: 'completed',
              invalidatedSessionCount: sessionTokens.length,
              initiationRequestId: resetToken.requestId ?? null,
            },
            ipAddress,
            userAgent,
          })
        )
      );

      return sessionTokens;
    });

    if (sessionTokens === null) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    await clearSessionCache(sessionTokens);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        component: 'reset-password',
        event: 'password_reset_completed',
        outcome: 'success',
        requestId: reqContext.requestId,
        correlationId: resetToken.id,
        invalidatedSessionCount: sessionTokens.length,
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error(
      JSON.stringify({
        component: 'reset-password',
        event: 'request_processing',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
