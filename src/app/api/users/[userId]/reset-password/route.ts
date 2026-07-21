/**
 * Admin-triggered Password Reset API
 *
 * POST /api/users/:userId/reset-password
 *
 * An org ADMIN sends a password-reset EMAIL to a member of their org. The admin
 * never sees or sets the password: this reuses the standard reset-token flow, so
 * the user completes the reset (and their sessions are invalidated) themselves.
 *
 * Guards mirror GET/PATCH on the parent route: admin else 403; target must be an
 * ACTIVE member of the caller's org (both the membership and the global account)
 * else 404 for a non-member (existence-hiding) or 400 for a deactivated one.
 *
 * Multi-org targets are allowed: the reset link is delivered only to the user's
 * own account email and redemption is bound to the token's userId, so this is
 * not a cross-tenant takeover vector (unlike email/2FA edits, which the PATCH
 * route blocks for multi-org users).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { bootstrapDb, withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability } from '@/lib/deployment-capabilities';
import { JOB_NAMES, QUEUE_NAMES } from '@/workers/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

// Minimum spacing between admin-triggered resets for the same target, so a
// double-click or abuse cannot mint an unbounded stream of valid tokens/emails.
const RESET_COOLDOWN_MS = 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const baseUrl = process.env['APP_URL'];
    if (!baseUrl) {
      console.error('[UserResetPasswordAPI] APP_URL must be configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Fail fast when the platform cannot send email at all: an admin action must
    // not mint a token and report success when nothing will be delivered.
    const providers = getProviders();
    const canAsync = hasCapability('canSendAsyncEmail');
    const canSync = hasCapability('canSendSyncEmail');
    if (!canAsync && !canSync) {
      return NextResponse.json({ error: 'Email delivery is not configured' }, { status: 503 });
    }

    // Membership check, cooldown, token mint, per-org sender, and audit all run
    // in one org-scoped transaction so RLS enforces tenant isolation.
    const result = await withOrgContext(session.organizationId, async (tx) => {
      const userOrg = await tx.userOrganization.findFirst({
        where: { userId, organizationId: session.organizationId },
        include: {
          user: { select: { id: true, email: true, firstName: true, isActive: true } },
        },
      });
      if (!userOrg) {
        return { error: 'User not found in organization', status: 404 } as const;
      }
      // Both the org membership AND the global account must be active.
      if (!userOrg.isActive || !userOrg.user.isActive) {
        return {
          error: 'Cannot reset the password of a deactivated user',
          status: 400,
        } as const;
      }

      // Serialize concurrent resets for the same target so the cooldown check
      // below cannot be raced by two simultaneous requests (mirrors the PATCH
      // last-admin guard's row lock).
      await tx.$queryRaw`
        SELECT 1 FROM user_organizations
        WHERE "userId" = ${userId} AND "organizationId" = ${session.organizationId}
        FOR UPDATE`;

      // Cooldown: skip if a fresh, unused token was just issued for this user.
      const recent = await tx.passwordResetToken.findFirst({
        where: {
          userId,
          usedAt: null,
          expiresAt: { gt: new Date() },
          createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        return {
          error: 'A password reset was just sent. Please wait a minute before retrying.',
          status: 429,
        } as const;
      }

      const token = randomBytes(32).toString('base64url');
      await tx.passwordResetToken.create({
        data: { userId, token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      });

      const org = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: { name: true, emailSenderName: true, emailSenderAddress: true },
      });

      // Audit the REQUEST (the intent), which is accurate regardless of whether
      // delivery below succeeds. The token itself is never recorded here.
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'USER_PASSWORD_RESET',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          description: `Requested a password reset for ${userOrg.user.email}`,
          metadata: { targetUserId: userId },
        },
      });

      return { success: true as const, token, user: userOrg.user, org };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Deliver via the per-org sender (falls back to the global sender when
    // unset). Unlike the anonymous forgot-password flow, an admin action DOES
    // surface delivery failures so the admin knows to retry.
    const orgName = result.org?.name || 'VaultSpace';
    const senderFrom = result.org?.emailSenderAddress || undefined;
    const senderName = result.org?.emailSenderName || result.org?.name || undefined;
    const resetUrl = `${baseUrl}/auth/reset-password?token=${result.token}`;

    try {
      if (canAsync) {
        await providers.job.addJob(QUEUE_NAMES.NORMAL, JOB_NAMES.EMAIL_SEND, {
          to: result.user.email,
          subject: `Reset your ${orgName} password`,
          template: 'password-reset',
          from: senderFrom,
          fromName: senderName,
          data: {
            userName: result.user.firstName || 'User',
            organizationName: orgName,
            resetUrl,
            expiresIn: '1 hour',
          },
        });
      } else {
        await providers.email.sendEmail({
          to: result.user.email,
          subject: `Reset your ${orgName} password`,
          html: `<p>Hi ${result.user.firstName || 'User'},</p><p>An administrator has requested a password reset for your account. Click <a href="${resetUrl}">here</a> to set a new password.</p><p>This link expires in 1 hour.</p>`,
          text: `Hi ${result.user.firstName || 'User'},\n\nAn administrator has requested a password reset for your account. Set a new password here: ${resetUrl}\n\nThis link expires in 1 hour.`,
          from: senderFrom,
          fromName: senderName,
        });
      }
    } catch (emailErr) {
      console.error('[UserResetPasswordAPI] email delivery failed:', emailErr);
      // Neutralize the undelivered token so it cannot linger for an hour and so
      // an immediate retry is not blocked by the cooldown. The tx above is
      // closed, so use a fresh handle; best-effort. (password_reset_tokens has
      // no RLS, so bootstrapDb is appropriate here.)
      try {
        await bootstrapDb.passwordResetToken.updateMany({
          where: { token: result.token, usedAt: null },
          data: { usedAt: new Date() },
        });
      } catch (cleanupErr) {
        console.error('[UserResetPasswordAPI] failed to invalidate undelivered token:', cleanupErr);
      }
      return NextResponse.json(
        { error: 'Could not send the reset email. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserResetPasswordAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to send password reset' }, { status: 500 });
  }
}
