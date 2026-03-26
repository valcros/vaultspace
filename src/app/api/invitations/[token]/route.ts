/**
 * GET /api/invitations/:token
 *
 * Public endpoint — returns invitation details for pre-populating
 * the registration form. No authentication required.
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    const invitation = await db.invitation.findUnique({
      where: { invitationToken: token },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 });
    }

    if (invitation.status !== 'PENDING') {
      return NextResponse.json({ error: 'Invitation already used' }, { status: 410 });
    }

    if (new Date() > invitation.expiresAt) {
      return NextResponse.json({ error: 'Invitation expired' }, { status: 410 });
    }

    return NextResponse.json({
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization.name,
    });
  } catch (error) {
    console.error('[InvitationAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch invitation' }, { status: 500 });
  }
}
