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
            name: true,
          },
        },
        organization: {
          select: {
            name: true,
            logoUrl: true,
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

    // Determine access type based on room/link settings
    let accessType: 'PUBLIC' | 'EMAIL_REQUIRED' | 'PASSWORD_PROTECTED' = 'PUBLIC';
    if (link.requiresPassword) {
      accessType = 'PASSWORD_PROTECTED';
    } else if (link.requiresEmailVerification) {
      accessType = 'EMAIL_REQUIRED';
    }

    return NextResponse.json({
      link: {
        id: link.id,
        name: link.name,
        roomName: link.room.name,
        organizationName: link.organization.name,
        organizationLogo: link.organization.logoUrl,
        accessType,
        ndaRequired: false, // NDA not in current schema
        ndaText: null,
        expiresAt: link.expiresAt?.toISOString() || null,
        isActive: link.isActive,
      },
    });
  } catch (error) {
    console.error('[ViewerInfoAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load link information' },
      { status: 500 }
    );
  }
}
