/**
 * Registration API (F004)
 *
 * POST /api/auth/register - Create new user account
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { db } from '@/lib/db';
import { setSessionCookie } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';
import { z } from 'zod';

const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  inviteToken: z.string().optional(),
  title: z.string().max(255).optional(),
  relationship: z.string().max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, password, inviteToken, title, relationship } =
      registerSchema.parse(body);

    const normalizedEmail = email.toLowerCase();

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Registration requires an invitation (Issue 4a)
    if (!inviteToken) {
      return NextResponse.json({ error: 'Registration requires an invitation' }, { status: 403 });
    }

    // Validate invitation
    let organizationId: string | null = null;
    let role: 'ADMIN' | 'VIEWER' = 'ADMIN';

    const invitation = await db.invitation.findUnique({
      where: { invitationToken: inviteToken },
      include: { organization: true },
    });

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 });
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
    }

    if (invitation.status !== 'PENDING') {
      return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 });
    }

    // Email must match invitation (Issue 4b)
    if (invitation.email.toLowerCase() !== normalizedEmail) {
      return NextResponse.json({ error: 'Email does not match invitation' }, { status: 400 });
    }

    organizationId = invitation.organizationId;
    role = invitation.role as 'ADMIN' | 'VIEWER';

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user and accept invitation in transaction (Issue 4b)
    const result = await db.$transaction(async (tx) => {
      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });

      // Create user
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName,
          title: title || null,
          relationship: relationship || null,
          isActive: true,
        },
      });

      // Add user to organization
      await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: organizationId!,
          role,
          isActive: true,
        },
      });

      const organization = await tx.organization.findUnique({
        where: { id: organizationId! },
        select: { id: true, name: true, slug: true },
      });

      return { user, organization };
    });

    // Generate session token
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000
    );

    // Create session
    await db.session.create({
      data: {
        userId: result.user.id,
        organizationId: organizationId!,
        token: sessionToken,
        expiresAt,
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
      },
    });

    // Set session cookie
    await setSessionCookie(sessionToken, expiresAt);

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
      organization: result.organization,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[RegisterAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
