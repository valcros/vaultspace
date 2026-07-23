/**
 * Public Link Access API (F016, F017, F116)
 *
 * GET  /api/links/:slug - Get link details (public)
 * POST /api/links/:slug/verify - Verify password/email
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { bootstrapDb, withOrgContext } from '@/lib/db';
import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from '@/lib/audit/accessAudit';
import { getRequestContext } from '@/lib/middleware';
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

    // PRE-RLS BOOTSTRAP: Public link info lookup by slug
    // This is intentionally unauthenticated - returns minimal public info
    const link = await bootstrapDb.link.findFirst({
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
      return NextResponse.json({ error: 'Link not found or expired' }, { status: 404 });
    }

    // Check if link is expired
    if (link.expiresAt && link.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Link has expired' }, { status: 410 });
    }

    // Check if max views reached
    if (link.maxViews !== null && link.viewCount >= link.maxViews) {
      return NextResponse.json({ error: 'Link has reached maximum views' }, { status: 410 });
    }

    // Check if room is accessible
    if (link.room.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Room is not accessible' }, { status: 403 });
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
    return NextResponse.json({ error: 'Failed to get link' }, { status: 500 });
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
    const reqContext = getRequestContext(request);

    // PRE-RLS BOOTSTRAP: Narrowly scoped lookup to resolve organizationId from slug
    const link = await bootstrapDb.link.findFirst({
      where: {
        slug,
        isActive: true,
      },
      select: {
        id: true,
        organizationId: true,
        roomId: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
        requiresPassword: true,
        passwordHash: true,
        requiresEmailVerification: true,
        allowedEmails: true,
        permission: true,
        scope: true,
        scopedFolderId: true,
        scopedDocumentId: true,
        room: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json({ error: 'Link not found or expired' }, { status: 404 });
    }

    const auditDenied = async (reason: string) => {
      await captureAccessAudit({
        organizationId: link.organizationId,
        eventType: 'LINK_ACCESS_DENIED',
        actorType: 'VIEWER',
        actorEmail: typeof email === 'string' ? email : null,
        roomId: link.roomId,
        requestId: reqContext.requestId,
        description: 'Share-link access denied',
        metadata: {
          reason,
          linkId: link.id,
          identityAssurance: typeof email === 'string' ? 'ASSERTED' : 'ANONYMOUS',
        },
        ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
        userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
        dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.LINK_ACCESS_DENIED,
        dedupeByIp: true,
      });
    };

    // Check expiry
    if (link.expiresAt && link.expiresAt < new Date()) {
      await auditDenied('LINK_EXPIRED');
      return NextResponse.json({ error: 'Link has expired' }, { status: 410 });
    }

    // Check max views
    if (link.maxViews !== null && link.viewCount >= link.maxViews) {
      await auditDenied('MAX_VIEWS_REACHED');
      return NextResponse.json({ error: 'Link has reached maximum views' }, { status: 410 });
    }

    // Check room status
    if (link.room.status !== 'ACTIVE') {
      await auditDenied('ROOM_NOT_ACTIVE');
      return NextResponse.json({ error: 'Room is not accessible' }, { status: 403 });
    }

    // Verify password if required
    if (link.requiresPassword) {
      if (!password) {
        await auditDenied('PASSWORD_REQUIRED');
        return NextResponse.json({ error: 'Password required' }, { status: 401 });
      }

      if (!link.passwordHash) {
        await auditDenied('LINK_CONFIGURATION_ERROR');
        return NextResponse.json({ error: 'Link configuration error' }, { status: 500 });
      }

      const passwordValid = await bcrypt.compare(password, link.passwordHash);
      if (!passwordValid) {
        await auditDenied('PASSWORD_INVALID');
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
      }
    }

    // Verify email if required
    if (link.requiresEmailVerification || link.allowedEmails.length > 0) {
      if (!email) {
        await auditDenied('ASSERTED_EMAIL_REQUIRED');
        return NextResponse.json({ error: 'Email required' }, { status: 401 });
      }

      // Check if email is allowed
      if (link.allowedEmails.length > 0) {
        const normalizedEmail = email.toLowerCase().trim();
        const allowed = link.allowedEmails.some(
          (e: string) => e.toLowerCase().trim() === normalizedEmail
        );

        if (!allowed) {
          await auditDenied('ASSERTED_EMAIL_NOT_ALLOWED');
          return NextResponse.json(
            { error: 'Email not authorized for this link' },
            { status: 403 }
          );
        }
      }
    }

    // Generate session token
    const sessionToken = randomBytes(32).toString('base64url');

    // Now we have organizationId - use RLS context for all writes
    const viewSession = await withOrgContext(link.organizationId, async (tx) => {
      // Create view session
      const viewSession = await tx.viewSession.create({
        data: {
          organizationId: link.organizationId,
          roomId: link.roomId,
          linkId: link.id,
          sessionToken,
          visitorEmail: email?.toLowerCase().trim() ?? null,
          ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
          userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
        },
      });

      // Increment view count
      await tx.link.update({
        where: { id: link.id },
        data: {
          viewCount: { increment: 1 },
          lastAccessedAt: new Date(),
        },
      });

      // Record visit
      await tx.linkVisit.create({
        data: {
          organizationId: link.organizationId,
          linkId: link.id,
          roomId: link.roomId,
          viewSessionId: viewSession.id,
          visitorEmail: email?.toLowerCase().trim() ?? null,
          ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
          userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
        },
      });

      return viewSession;
    });

    // Queue view notification job (async via job queue per architecture)
    // Only notify if link is scoped to a document
    if (link.scopedDocumentId) {
      const providers = getProviders();
      providers.job
        .addJob('normal', 'notify-document-viewed', {
          organizationId: link.organizationId,
          roomId: link.roomId,
          documentId: link.scopedDocumentId,
          viewerEmail: email?.toLowerCase().trim(),
        })
        .catch((err) => console.error('[PublicLinkAPI] Failed to queue notification:', err));
    }

    await captureAccessAudit({
      organizationId: link.organizationId,
      eventType: 'LINK_ACCESSED',
      actorType: 'VIEWER',
      actorEmail: typeof email === 'string' ? email : null,
      roomId: link.roomId,
      documentId: link.scopedDocumentId,
      viewSessionId: viewSession.id,
      requestId: reqContext.requestId,
      description: 'Share link accessed',
      metadata: {
        linkId: link.id,
        identityAssurance: typeof email === 'string' ? 'ASSERTED' : 'ANONYMOUS',
      },
      ipAddress: reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress,
      userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
    });

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
    return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
  }
}
