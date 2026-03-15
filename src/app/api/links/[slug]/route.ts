/**
 * Public Link Access API (F016, F017, F116)
 *
 * GET  /api/links/:slug - Get link details (public)
 * POST /api/links/:slug/verify - Verify password/email
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { db } from '@/lib/db';
import { EmailNotificationService } from '@/services/notifications';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/links/:slug
 * Get public link details (what can viewer see without auth)
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;

    // Find link
    const link = await db.link.findFirst({
      where: {
        slug,
        isActive: true,
      },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        organization: {
          select: {
            name: true,
            logoUrl: true,
            primaryColor: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json(
        { error: 'Link not found or expired' },
        { status: 404 }
      );
    }

    // Check if link is expired
    if (link.expiresAt && link.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Link has expired' },
        { status: 410 }
      );
    }

    // Check if max views reached
    if (link.maxViews !== null && link.viewCount >= link.maxViews) {
      return NextResponse.json(
        { error: 'Link has reached maximum views' },
        { status: 410 }
      );
    }

    // Check if room is accessible
    if (link.room.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Room is not accessible' },
        { status: 403 }
      );
    }

    // Return public info (without sensitive data)
    return NextResponse.json({
      link: {
        slug: link.slug,
        name: link.name,
        permission: link.permission,
        scope: link.scope,
        requiresPassword: link.requiresPassword,
        requiresEmailVerification: link.requiresEmailVerification,
        hasEmailRestrictions: link.allowedEmails.length > 0,
      },
      room: {
        name: link.room.name,
      },
      organization: {
        name: link.organization.name,
        logoUrl: link.organization.logoUrl,
        primaryColor: link.organization.primaryColor,
      },
    });
  } catch (error) {
    console.error('[PublicLinkAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get link' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/links/:slug
 * Verify access (password and/or email)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;

    const body = await request.json();
    const { password, email } = body;

    // Find link
    const link = await db.link.findFirst({
      where: {
        slug,
        isActive: true,
      },
      include: {
        room: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json(
        { error: 'Link not found or expired' },
        { status: 404 }
      );
    }

    // Check expiry
    if (link.expiresAt && link.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Link has expired' },
        { status: 410 }
      );
    }

    // Check max views
    if (link.maxViews !== null && link.viewCount >= link.maxViews) {
      return NextResponse.json(
        { error: 'Link has reached maximum views' },
        { status: 410 }
      );
    }

    // Check room status
    if (link.room.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Room is not accessible' },
        { status: 403 }
      );
    }

    // Verify password if required
    if (link.requiresPassword) {
      if (!password) {
        return NextResponse.json(
          { error: 'Password required' },
          { status: 401 }
        );
      }

      if (!link.passwordHash) {
        return NextResponse.json(
          { error: 'Link configuration error' },
          { status: 500 }
        );
      }

      const passwordValid = await bcrypt.compare(password, link.passwordHash);
      if (!passwordValid) {
        return NextResponse.json(
          { error: 'Invalid password' },
          { status: 401 }
        );
      }
    }

    // Verify email if required
    if (link.requiresEmailVerification || link.allowedEmails.length > 0) {
      if (!email) {
        return NextResponse.json(
          { error: 'Email required' },
          { status: 401 }
        );
      }

      // Check if email is allowed
      if (link.allowedEmails.length > 0) {
        const normalizedEmail = email.toLowerCase().trim();
        const allowed = link.allowedEmails.some(
          (e) => e.toLowerCase().trim() === normalizedEmail
        );

        if (!allowed) {
          return NextResponse.json(
            { error: 'Email not authorized for this link' },
            { status: 403 }
          );
        }
      }
    }

    // Generate session token
    const sessionToken = randomBytes(32).toString('base64url');

    // Create view session
    const viewSession = await db.viewSession.create({
      data: {
        organizationId: link.organizationId,
        roomId: link.roomId,
        linkId: link.id,
        sessionToken,
        visitorEmail: email?.toLowerCase().trim() ?? null,
      },
    });

    // Increment view count
    await db.link.update({
      where: { id: link.id },
      data: {
        viewCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    // Record visit
    await db.linkVisit.create({
      data: {
        organizationId: link.organizationId,
        linkId: link.id,
        roomId: link.roomId,
        viewSessionId: viewSession.id,
        visitorEmail: email?.toLowerCase().trim() ?? null,
      },
    });

    // Send view notification to room admins (non-blocking)
    // Only notify if link is scoped to a document
    if (link.scopedDocumentId) {
      sendViewNotification(
        link.organizationId,
        link.roomId,
        link.scopedDocumentId,
        email?.toLowerCase().trim()
      ).catch((err) => console.error('[PublicLinkAPI] Notification error:', err));
    }

    return NextResponse.json({
      sessionToken,
      roomId: link.roomId,
      permission: link.permission,
      scope: link.scope,
      scopedFolderId: link.scopedFolderId,
      scopedDocumentId: link.scopedDocumentId,
    });
  } catch (error) {
    console.error('[PublicLinkAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500 }
    );
  }
}

/**
 * Send view notification to room admins (non-blocking)
 */
async function sendViewNotification(
  organizationId: string,
  roomId: string,
  documentId: string,
  viewerEmail?: string
): Promise<void> {
  const providers = getProviders();
  const baseUrl = process.env['APP_URL'] || 'http://localhost:3000';

  const notificationService = new EmailNotificationService({
    emailProvider: providers.email,
    fromAddress: process.env['SMTP_FROM'] || 'noreply@vaultspace.local',
    appUrl: baseUrl,
  });

  await notificationService.notifyDocumentViewed({
    organizationId,
    roomId,
    documentId,
    viewerEmail,
  });
}
