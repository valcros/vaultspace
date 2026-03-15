/**
 * Setup API (F128)
 *
 * POST /api/setup - Initial setup wizard
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { db } from '@/lib/db';
import { setSessionCookie } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';
import { z } from 'zod';

const setupSchema = z.object({
  organizationName: z.string().min(1, 'Organization name is required'),
  organizationSlug: z
    .string()
    .min(1, 'Organization slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  adminFirstName: z.string().min(1, 'First name is required'),
  adminLastName: z.string().min(1, 'Last name is required'),
  adminEmail: z.string().email('Invalid email address'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  try {
    // Check if setup has already been completed
    const existingOrg = await db.organization.findFirst();
    if (existingOrg) {
      return NextResponse.json(
        { error: 'Setup has already been completed' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      organizationName,
      organizationSlug,
      adminFirstName,
      adminLastName,
      adminEmail,
      adminPassword,
    } = setupSchema.parse(body);

    // Check if slug is unique
    const existingSlug = await db.organization.findUnique({
      where: { slug: organizationSlug },
    });

    if (existingSlug) {
      return NextResponse.json(
        { error: 'Organization slug is already taken' },
        { status: 409 }
      );
    }

    // Check if admin email is unique
    const existingUser = await db.user.findUnique({
      where: { email: adminEmail.toLowerCase() },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // Create organization and admin user in transaction
    const result = await db.$transaction(async (tx) => {
      // Create organization
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug: organizationSlug,
          isActive: true,
        },
      });

      // Create admin user
      const user = await tx.user.create({
        data: {
          email: adminEmail.toLowerCase(),
          passwordHash,
          firstName: adminFirstName,
          lastName: adminLastName,
          isActive: true,
        },
      });

      // Add user to organization as admin
      await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'ADMIN',
          isActive: true,
        },
      });

      return { organization, user };
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
        organizationId: result.organization.id,
        token: sessionToken,
        expiresAt,
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
      },
    });

    // Set session cookie
    await setSessionCookie(sessionToken, expiresAt);

    return NextResponse.json({
      success: true,
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
      },
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[SetupAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to complete setup' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Check if setup has been completed
    const existingOrg = await db.organization.findFirst();

    return NextResponse.json({
      setupRequired: !existingOrg,
    });
  } catch (error) {
    console.error('[SetupAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check setup status' },
      { status: 500 }
    );
  }
}
