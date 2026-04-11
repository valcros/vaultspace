/**
 * Forgot Password API (F004)
 *
 * POST /api/auth/forgot-password - Request password reset
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';
import { z } from 'zod';
import { hasCapability } from '@/lib/deployment-capabilities';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    const normalizedEmail = email.toLowerCase();

    // Find user (don't reveal if user exists)
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organizations: {
          where: { isActive: true },
          include: {
            organization: {
              select: { name: true },
            },
          },
          take: 1,
        },
      },
    });

    // Always return success to prevent email enumeration
    if (!user || !user.isActive) {
      return NextResponse.json({ success: true });
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });

    // Send reset email via job queue (fallback to sync if async unavailable)
    const providers = getProviders();
    const orgName = user.organizations[0]?.organization.name || 'VaultSpace';
    const baseUrl = process.env['APP_URL'];
    if (!baseUrl) {
      console.error('[ForgotPasswordAPI] APP_URL must be configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;

    // Try async email first (via job queue), fall back to sync if unavailable
    if (hasCapability('canSendAsyncEmail')) {
      await providers.job.addJob('normal', 'send-password-reset', {
        to: user.email,
        userName: user.firstName || 'User',
        organizationName: orgName,
        resetUrl,
        expiresIn: '1 hour',
      });
    } else if (hasCapability('canSendSyncEmail')) {
      // Fallback: send email synchronously (may timeout on slow SMTP)
      try {
        const textBody = `Hi ${user.firstName || 'User'},\n\nClick here to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, please ignore this email.`;
        await providers.email.sendEmail({
          to: user.email,
          subject: `Reset your ${orgName} password`,
          html: `<p>Hi ${user.firstName || 'User'},</p><p>Click <a href="${resetUrl}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p><p>If you didn't request this, please ignore this email.</p>`,
          text: textBody,
        });
      } catch (emailErr) {
        console.error('[ForgotPasswordAPI] Sync email failed:', emailErr);
        // Don't return error to prevent email enumeration
      }
    } else {
      // No email capability available - log warning but don't fail
      console.warn('[ForgotPasswordAPI] Email not configured - password reset email not sent');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[ForgotPasswordAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
