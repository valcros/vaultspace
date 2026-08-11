/**
 * Public Link Access API (F016, F017, F116)
 *
 * GET  /api/links/:slug - Get link details (public)
 * POST /api/links/:slug/verify - Verify password/email
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from '@/lib/audit/accessAudit';
import { getRequestContext } from '@/lib/middleware';
import {
  admitLinkViewer,
  evaluateLinkState,
  getLinkPolicyRecord,
} from '@/lib/permissions/LinkPolicy';
import { getClientIp } from '@/lib/utils/ip';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const linkAccessSchema = z.object({
  password: z.string().max(1024).optional(),
  email: z.string().trim().email().max(320).optional(),
  ndaAccepted: z.boolean().optional(),
});

/**
 * GET /api/links/:slug
 * Get public link details (what can viewer see without auth)
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;

    const link = await getLinkPolicyRecord(slug);

    if (!link) {
      return NextResponse.json({ error: 'Link not found or expired' }, { status: 404 });
    }

    const decision = evaluateLinkState(link, { admission: true });
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.message }, { status: decision.status });
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

    const parsedBody = linkAccessSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { password, email, ndaAccepted } = parsedBody.data;
    const reqContext = getRequestContext(request);

    const link = await getLinkPolicyRecord(slug);

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

    const admission = await admitLinkViewer(link, {
      password,
      email,
      ndaAccepted,
      sourceIp: getClientIp(request.headers) ?? 'unknown',
      userAgent: reqContext.userAgent === 'unknown' ? null : reqContext.userAgent,
    });
    if (!admission.allowed) {
      await auditDenied(admission.code);
      return NextResponse.json(
        {
          error: admission.message,
          ...(admission.code === 'NDA_ACCEPTANCE_REQUIRED'
            ? { requiresNda: true, ndaContent: link.room.ndaContent }
            : {}),
        },
        { status: admission.status }
      );
    }

    // Queue view notification job (async via job queue per architecture)
    // Only notify if link is scoped to a document
    if (link.scopedDocumentId) {
      const providers = getProviders();
      providers.job
        .addJob('normal', 'notify-document-viewed', {
          organizationId: link.organizationId,
          roomId: link.roomId,
          documentId: link.scopedDocumentId,
          viewerEmail: admission.normalizedEmail ?? undefined,
        })
        .catch((err) => console.error('[PublicLinkAPI] Failed to queue notification:', err));
    }

    await captureAccessAudit({
      organizationId: link.organizationId,
      eventType: 'LINK_ACCESSED',
      actorType: 'VIEWER',
      actorEmail: admission.normalizedEmail,
      roomId: link.roomId,
      documentId: link.scopedDocumentId,
      viewSessionId: admission.session.id,
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
      sessionToken: admission.sessionToken,
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
