/**
 * Viewer Link Info API
 *
 * GET /api/view/[shareToken]/info - Get share link information
 */

import { NextRequest, NextResponse } from 'next/server';

import { evaluateLinkState, getLinkPolicyRecord } from '@/lib/permissions/LinkPolicy';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;

    const link = await getLinkPolicyRecord(shareToken);

    if (!link) {
      return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
    }

    const existingSession = await getViewerSession(shareToken, viewerSessionBaseSelect);
    const existingSessionResult = requireViewerSession(shareToken, existingSession);
    const alreadyAdmitted = 'session' in existingSessionResult;

    const decision = evaluateLinkState(link, { admission: !alreadyAdmitted });
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.message }, { status: decision.status });
    }

    return NextResponse.json({
      link: {
        id: link.id,
        name: link.name,
        roomName: link.room.name,
        organizationName: link.organization.name,
        organizationLogo: link.room.brandLogoUrl || link.organization.logoUrl,
        brandColor: link.room.brandColor || link.organization.primaryColor || null,
        requiresPassword: link.requiresPassword ?? false,
        requiresEmail: link.requiresEmailVerification || link.allowedEmails.length > 0,
        ndaRequired: link.room.requiresNda ?? false,
        ndaText: link.room.ndaContent ?? null,
        expiresAt: link.expiresAt?.toISOString() || null,
        isActive: link.isActive,
        alreadyAdmitted,
      },
    });
  } catch (error) {
    console.error('[ViewerInfoAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load link information' }, { status: 500 });
  }
}
