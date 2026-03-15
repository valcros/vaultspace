/**
 * Viewer Access API
 *
 * POST /api/view/[shareToken]/access - Verify access and create viewer session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const body = await request.json();
    const { email, password, ndaAccepted: _ndaAccepted } = body;

    // Find link by slug
    const link = await db.link.findFirst({
      where: {
        slug: shareToken,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            organizationId: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json(
        { error: 'This link is invalid or has expired' },
        { status: 404 }
      );
    }

    // Verify email if required
    if (link.requiresEmailVerification) {
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return NextResponse.json(
          { error: 'A valid email address is required' },
          { status: 400 }
        );
      }

      // Check if email is in allowed list (if configured)
      if (link.allowedEmails.length > 0) {
        const normalizedEmail = email.toLowerCase().trim();
        const isAllowed = link.allowedEmails.some(
          (e) => e.toLowerCase().trim() === normalizedEmail
        );
        if (!isAllowed) {
          return NextResponse.json(
            { error: 'Your email address is not authorized to access this link' },
            { status: 403 }
          );
        }
      }
    }

    // Verify password if required
    if (link.requiresPassword) {
      if (!password || typeof password !== 'string') {
        return NextResponse.json(
          { error: 'Password is required' },
          { status: 400 }
        );
      }

      const isValid = link.passwordHash
        ? await bcrypt.compare(password, link.passwordHash)
        : false;

      if (!isValid) {
        return NextResponse.json(
          { error: 'Incorrect password' },
          { status: 401 }
        );
      }
    }

    // Create view session
    const sessionToken = randomBytes(32).toString('base64url');

    await db.viewSession.create({
      data: {
        organizationId: link.room.organizationId,
        roomId: link.room.id,
        linkId: link.id,
        sessionToken,
        visitorEmail: email?.toLowerCase().trim() || null,
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    // Update link view count
    await db.link.update({
      where: { id: link.id },
      data: {
        viewCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    // Set viewer session cookie
    const cookieStore = await cookies();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    cookieStore.set(`viewer_${shareToken}`, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: `/view/${shareToken}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ViewerAccessAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500 }
    );
  }
}
