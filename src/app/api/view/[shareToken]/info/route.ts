/**
 * Viewer Link Info API
 *
 * GET /api/view/[shareToken]/info - Get share link information
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;

    // PRE-RLS BOOTSTRAP: Public link info lookup by slug
    // This is intentionally unauthenticated - returns minimal public info
    // to display the access gate (password/email requirements, branding)
    const link = await db.link.findFirst({
      where: {
        slug: shareToken,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        room: {
          select: {
            name: true,
            requiresNda: true,
            ndaContent: true,
            brandColor: true,
            brandLogoUrl: true,
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
      return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
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
        requiresEmail: link.requiresEmailVerification ?? false,
        ndaRequired: link.room.requiresNda ?? false,
        ndaText: link.room.ndaContent ?? null,
        expiresAt: link.expiresAt?.toISOString() || null,
        isActive: link.isActive,
      },
    });
  } catch (error) {
    console.error('[ViewerInfoAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load link information' }, { status: 500 });
  }
}
