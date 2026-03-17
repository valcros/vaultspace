/**
 * Team Member Invite API (F044)
 *
 * POST /api/users/invite - Invite a team member
 * GET  /api/users/invite - List pending invitations
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { requireAuth } from '@/lib/middleware';
import { db, withOrgContext } from '@/lib/db';
import { EmailNotificationService } from '@/services/notifications';
import { getProviders } from '@/providers';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/users/invite
 * Send invitation to a new team member
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role = 'VIEWER' } = body;

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Validate role
    const validRoles = ['ADMIN', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be ADMIN or VIEWER' }, { status: 400 });
    }

    // Check if user already exists in organization (global user lookup)
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organizations: {
          where: { organizationId: session.organizationId },
        },
      },
    });

    if (existingUser && existingUser.organizations.length > 0) {
      return NextResponse.json(
        { error: 'User is already a member of this organization' },
        { status: 400 }
      );
    }

    // Generate invitation token
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

    // Build invitation URL - APP_URL is required
    const baseUrl = process.env['APP_URL'];
    if (!baseUrl) {
      console.error('[InviteAPI] APP_URL environment variable is required');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const invitationUrl = baseUrl + '/auth/register?token=' + invitationToken;

    // Use RLS context for all org-scoped operations
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Check for existing pending invitation
      const existingInvite = await tx.invitation.findFirst({
        where: {
          organizationId: session.organizationId,
          email: normalizedEmail,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      });

      if (existingInvite) {
        return { error: 'An invitation is already pending for this email', status: 400 };
      }

      // Create invitation
      const invitation = await tx.invitation.create({
        data: {
          organizationId: session.organizationId,
          email: normalizedEmail,
          role: role as 'ADMIN' | 'VIEWER',
          invitationToken,
          invitationUrl,
          expiresAt,
          invitedByUserId: session.userId,
        },
        include: {
          invitedByUser: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Get organization name for the email
      const organization = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: { name: true },
      });

      return { invitation, organizationName: organization?.name };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { invitation, organizationName } = result;

    // Send invitation email (outside RLS context - email is external)
    try {
      console.log('[InviteAPI] Preparing to send invitation email to:', normalizedEmail);
      const providers = getProviders();
      const senderAddress =
        process.env['ACS_SENDER_ADDRESS'] || process.env['SMTP_FROM'] || 'noreply@vaultspace.org';
      console.log('[InviteAPI] Using sender address:', senderAddress);

      const notificationService = new EmailNotificationService({
        emailProvider: providers.email,
        fromAddress: senderAddress,
        appUrl: baseUrl,
      });

      // Get inviter name (global user lookup)
      const inviter = await db.user.findUnique({
        where: { id: session.userId },
        select: { firstName: true, lastName: true },
      });
      const inviterName = inviter
        ? ((inviter.firstName || '') + ' ' + (inviter.lastName || '')).trim() || 'A team member'
        : 'A team member';

      console.log('[InviteAPI] Sending invitation email...');
      await notificationService.sendInvitationEmail({
        email: normalizedEmail,
        inviterName,
        organizationName: organizationName || 'your organization',
        role,
        invitationUrl,
        expiresAt,
      });
      console.log('[InviteAPI] Invitation email sent successfully');
    } catch (emailError) {
      console.error('[InviteAPI] Failed to send invitation email:', emailError);
      // Continue - invitation was created, email just failed
    }

    return NextResponse.json(
      {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          invitationUrl: invitation.invitationUrl,
          invitedBy: invitation.invitedByUser
            ? (invitation.invitedByUser.firstName + ' ' + invitation.invitedByUser.lastName).trim()
            : null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[InviteAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
  }
}

/**
 * GET /api/users/invite
 * List pending invitations
 */
export async function GET() {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
    const invitations = await withOrgContext(session.organizationId, async (tx) => {
      return tx.invitation.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          invitedByUser: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });
    });

    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
        invitedBy: inv.invitedByUser
          ? (inv.invitedByUser.firstName + ' ' + inv.invitedByUser.lastName).trim()
          : null,
      })),
    });
  } catch (error) {
    console.error('[InviteAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 });
  }
}
