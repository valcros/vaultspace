/**
 * Viewer Access API
 *
 * POST /api/view/[shareToken]/access - Verify access and create viewer session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from '@/lib/audit/accessAudit';
import { getRequestContext } from '@/lib/middleware';
import { admitLinkViewer, getLinkPolicyRecord } from '@/lib/permissions/LinkPolicy';
import { getClientIp } from '@/lib/utils/ip';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

const viewerAccessSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  password: z.string().max(1024).optional(),
  ndaAccepted: z.boolean().optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const parsedBody = viewerAccessSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { email, password, ndaAccepted } = parsedBody.data;
    const reqContext = getRequestContext(request);

    const existingSession = await getViewerSession(shareToken, viewerSessionBaseSelect);
    if ('session' in requireViewerSession(shareToken, existingSession)) {
      return NextResponse.json({ success: true, reused: true });
    }

    const link = await getLinkPolicyRecord(shareToken);

    if (!link) {
      return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
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
      email,
      password,
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

    // Set viewer session cookie
    const cookieStore = await cookies();
    const cookieLifetimeMs = Math.min(
      24 * 60 * 60 * 1000,
      link.maxSessionMinutes === null ? Number.POSITIVE_INFINITY : link.maxSessionMinutes * 60_000
    );
    const expiresAt = new Date(Date.now() + cookieLifetimeMs);
    cookieStore.set(`viewer_${shareToken}`, admission.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      // The viewer session must be available to both /view and /api/view routes.
      path: '/',
    });

    await captureAccessAudit({
      organizationId: link.organizationId,
      eventType: 'LINK_ACCESSED',
      actorType: 'VIEWER',
      actorEmail: admission.normalizedEmail,
      roomId: link.roomId,
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ViewerAccessAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
  }
}
