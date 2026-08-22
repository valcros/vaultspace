/**
 * Users Collection API (F052)
 *
 * GET /api/users - List organization users
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/users
 * List all users in the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);
    const view = new URL(request.url).searchParams.get('view') ?? 'active';

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (view !== 'active' && view !== 'archived') {
      return NextResponse.json({ error: 'Invalid users view' }, { status: 400 });
    }

    // Use RLS context for org-scoped queries
    const { userOrgs, invitations, viewerLinkInvites } = await withOrgContext(
      session.organizationId,
      async (tx) => {
        // Get all users in the organization
        const userOrgs = await tx.userOrganization.findMany({
          where: {
            organizationId: session.organizationId,
            ...(view === 'active'
              ? { isActive: true, user: { isActive: true } }
              : { OR: [{ isActive: false }, { user: { isActive: false } }] }),
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                createdAt: true,
                lastLoginAt: true,
                isActive: true,
              },
            },
          },
          orderBy: {
            user: { firstName: 'asc' },
          },
        });

        // Also get pending invitations
        const invitations =
          view === 'active'
            ? await tx.invitation.findMany({
                where: {
                  organizationId: session.organizationId,
                  status: 'PENDING',
                  expiresAt: { gt: new Date() },
                },
                select: {
                  id: true,
                  email: true,
                  role: true,
                  createdAt: true,
                  expiresAt: true,
                },
                orderBy: { createdAt: 'desc' },
              })
            : [];

        // Active viewer-link invites (email-gated links to specific rooms).
        // These are external parties who have not yet accessed the link.
        const viewerLinkInvites =
          view === 'active'
            ? await tx.link.findMany({
                where: {
                  organizationId: session.organizationId,
                  isActive: true,
                  allowedEmails: { isEmpty: false },
                  lastAccessedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                select: {
                  id: true,
                  slug: true,
                  allowedEmails: true,
                  inviteeName: true,
                  inviteeCompany: true,
                  lastAccessedAt: true,
                  inviteEmailSentAt: true,
                  createdAt: true,
                  expiresAt: true,
                  room: { select: { id: true, name: true } },
                  createdByUser: { select: { firstName: true, lastName: true, email: true } },
                },
                orderBy: { createdAt: 'desc' },
              })
            : [];

        return { userOrgs, invitations, viewerLinkInvites };
      }
    );

    return NextResponse.json({
      users: userOrgs.map((uo) => ({
        id: uo.user.id,
        email: uo.user.email,
        firstName: uo.user.firstName,
        lastName: uo.user.lastName,
        role: uo.role,
        isActive: uo.isActive && uo.user.isActive,
        archivedAt: uo.archivedAt?.toISOString() ?? null,
        archivedByUserId: uo.archivedByUserId,
        archiveReason: uo.archiveReason,
        company: uo.company,
        organizationUserType: uo.organizationUserType,
        ndaOnFile: uo.ndaOnFile,
        lifecycleStatus:
          view === 'archived'
            ? uo.archivedAt
              ? 'ARCHIVED_MEMBERSHIP'
              : 'DEACTIVATED_ACCOUNT'
            : 'ACTIVE',
        createdAt: uo.user.createdAt.toISOString(),
        lastLoginAt: uo.user.lastLoginAt?.toISOString() || null,
      })),
      pendingInvitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        createdAt: inv.createdAt.toISOString(),
        expiresAt: inv.expiresAt.toISOString(),
      })),
      viewerLinkInvites: viewerLinkInvites.map((link) => {
        const inviter = link.createdByUser;
        const inviterName = inviter
          ? `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email
          : null;
        return {
          id: link.id,
          email: link.allowedEmails[0] ?? '',
          inviteeName: link.inviteeName,
          inviteeCompany: link.inviteeCompany,
          roomId: link.room?.id ?? null,
          roomName: link.room?.name ?? null,
          invitedBy: inviterName,
          status: link.lastAccessedAt ? 'opened' : 'pending',
          emailSent: link.inviteEmailSentAt !== null,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('[UsersAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}
