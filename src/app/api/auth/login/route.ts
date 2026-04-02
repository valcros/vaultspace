/**
 * Login API (F004)
 *
 * POST /api/auth/login - Authenticate user with email/password
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes, createHmac } from 'crypto';

import { db } from '@/lib/db';
import { setSessionCookie } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';
import { z } from 'zod';

/**
 * Generate a signed temporary token for 2FA verification.
 * Format: userId:timestamp:hmac
 * Expires after 5 minutes.
 */
function generateTempToken(userId: string): string {
  const secret =
    process.env['SESSION_SECRET'] || process.env['NEXTAUTH_SECRET'] || 'vaultspace-2fa-temp-secret';
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', secret).update(`${userId}:${timestamp}`).digest('hex');
  return `${userId}:${timestamp}:${signature}`;
}

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, rememberMe } = loginSchema.parse(body);

    // Find user with their organizations
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
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
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if 2FA is enabled - if so, return a temp token instead of creating a session
    if (user.twoFactorEnabled) {
      const tempToken = generateTempToken(user.id);
      return NextResponse.json({
        requiresTwoFactor: true,
        tempToken,
      });
    }

    // Get default organization
    const userOrg = user.organizations[0];
    if (!userOrg || !userOrg.organization.isActive) {
      return NextResponse.json({ error: 'No active organization found' }, { status: 403 });
    }

    // Generate session token
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionDuration = rememberMe
      ? SESSION_CONFIG.EXTENDED_DURATION_DAYS * 24 * 60 * 60 * 1000
      : SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration);

    // Create session
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

    console.error('[LoginAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to sign in' }, { status: 500 });
  }
}
