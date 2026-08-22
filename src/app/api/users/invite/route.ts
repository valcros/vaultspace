/**
 * Team Member Invite API (F044)
 *
 * POST /api/users/invite - Invite a team member
 * GET  /api/users/invite - List pending invitations
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { EmailNotificationService } from '@/services/notifications';
import { getProviders } from '@/providers';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

class LegacyInvitationReissueConflictError extends Error {}

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
    const {
      email,
      role = 'VIEWER',
      roomIds,
      firstName,
      lastName,
      company,
      phone,
      userType,
      ndaOnFile,
      ndaOnFileReference,
    } = body;

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

    const normalizeOptionalText = (value: unknown, max: number, field: string) => {
      if (value === undefined || value === null) {return null;}
      if (typeof value !== 'string' || value.trim().length > max) {
        throw new Error(`Invalid ${field}`);
      }
      return value.trim() || null;
    };

    let inviteProfile: {
      firstName: string | null;
      lastName: string | null;
      company: string | null;
      phone: string | null;
      userType: 'FOUNDER' | 'INVESTOR' | 'PARTNER' | 'INVESTOR_REPRESENTATIVE' | 'EMPLOYEE' | 'CONSULTANT' | null;
      ndaOnFile: boolean;
      ndaOnFileReference: string | null;
    };
    try {
      const normalizedPhone = normalizeOptionalText(phone, 32, 'phone');
      if (normalizedPhone && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
        return NextResponse.json({ error: 'Phone must use E.164 format' }, { status: 400 });
      }
      const validUserTypes = [
        'FOUNDER',
        'INVESTOR',
        'PARTNER',
        'INVESTOR_REPRESENTATIVE',
        'EMPLOYEE',
        'CONSULTANT',
      ] as const;
      if (userType !== undefined && userType !== null && !validUserTypes.includes(userType)) {
        return NextResponse.json({ error: 'Invalid organization user type' }, { status: 400 });
      }
      if (ndaOnFile !== undefined && typeof ndaOnFile !== 'boolean') {
        return NextResponse.json({ error: 'ndaOnFile must be a boolean' }, { status: 400 });
      }
      inviteProfile = {
        firstName: normalizeOptionalText(firstName, 100, 'first name'),
        lastName: normalizeOptionalText(lastName, 100, 'last name'),
        company: normalizeOptionalText(company, 255, 'company'),
        phone: normalizedPhone,
        userType: (userType ?? null) as (typeof validUserTypes)[number] | null,
        ndaOnFile: ndaOnFile === true,
        ndaOnFileReference: normalizeOptionalText(ndaOnFileReference, 500, 'NDA reference'),
      };
      if (!inviteProfile.ndaOnFile && inviteProfile.ndaOnFileReference) {
        return NextResponse.json(
          { error: 'An NDA reference requires NDA on file to be enabled' },
          { status: 400 }
        );
      }
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Invalid profile' },
        { status: 400 }
      );
    }

    if (
      roomIds !== undefined &&
      (!Array.isArray(roomIds) || !roomIds.every((id) => typeof id === 'string'))
    ) {
      return NextResponse.json({ error: 'roomIds must be an array of room IDs' }, { status: 400 });
    }

    const normalizedRoomIds: string[] = [
      ...new Set(
        (Array.isArray(roomIds) ? roomIds : [])
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      ),
    ];

    if (role === 'ADMIN' && normalizedRoomIds.length > 0) {
      return NextResponse.json(
        { error: 'Administrator invitations cannot be scoped to individual rooms' },
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
    let result;
    try {
      result = await withOrgContext(session.organizationId, async (tx) => {
        // A single-room organization has no room-selection decision to make.
        // Resolve that default server-side so API clients receive the same safe
        // behavior as the UI. Multi-room organizations still require an explicit
        // viewer assignment; there is never an organization-wide Viewer fallback.
        let assignedRoomIds = normalizedRoomIds;
        if (role === 'VIEWER' && assignedRoomIds.length === 0) {
          const activeRooms = await tx.room.findMany({
            where: { organizationId: session.organizationId, status: 'ACTIVE' },
            select: { id: true },
            take: 2,
          });
          const onlyActiveRoom = activeRooms[0];
          if (activeRooms.length === 1 && onlyActiveRoom) {
            assignedRoomIds = [onlyActiveRoom.id];
          } else {
            return {
              error:
                activeRooms.length === 0
                  ? 'At least one active room is required before inviting a viewer'
                  : 'Select at least one active room for this viewer invitation',
              status: 400,
            };
          }
        }

        // The Strawman alternative would make every organization viewer see every
        // room. Instead, validate the administrator's explicit assignment here,
        // under the inviting organization context, before an email is issued.
        if (assignedRoomIds.length > 0) {
          const assignedRooms = await tx.room.findMany({
            where: {
              id: { in: assignedRoomIds },
              organizationId: session.organizationId,
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          if (assignedRooms.length !== assignedRoomIds.length) {
            return {
              error: 'Every assigned room must be active and belong to this organization',
              status: 400,
            };
          }
        }

        // Under org context, RLS reveals an existing user only when that user is
        // already a member of this organization. Users in other tenants remain
        // undisclosed and can still be invited through the normal acceptance flow.
        const existingUser = await tx.user.findUnique({
          where: { email: normalizedEmail },
          include: {
            organizations: {
              where: { organizationId: session.organizationId },
            },
          },
        });

        if (existingUser && existingUser.organizations.length > 0) {
          return { error: 'User is already a member of this organization', status: 400 };
        }

        // A legacy viewer invitation has no room assignments and must not block a
        // correct reissue. Atomically reject those stale invitations, while still
        // preserving the duplicate-invite guard for current scoped invites and
        // all administrator invites.
        const existingInvites = await tx.invitation.findMany({
          where: {
            organizationId: session.organizationId,
            email: normalizedEmail,
            status: 'PENDING',
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            role: true,
            roomAssignments: { select: { id: true } },
          },
        });

        const legacyViewerInviteIds =
          role === 'VIEWER'
            ? existingInvites
                .filter(
                  (existingInvite) =>
                    existingInvite.role === 'VIEWER' && existingInvite.roomAssignments.length === 0
                )
                .map((existingInvite) => existingInvite.id)
            : [];
        const hasBlockingInvite = existingInvites.some(
          (existingInvite) => !legacyViewerInviteIds.includes(existingInvite.id)
        );

        if (hasBlockingInvite) {
          return { error: 'An invitation is already pending for this email', status: 400 };
        }

        if (legacyViewerInviteIds.length > 0) {
          const invalidated = await tx.invitation.updateMany({
            where: { id: { in: legacyViewerInviteIds }, status: 'PENDING' },
            data: { status: 'REJECTED' },
          });
          if (invalidated.count !== legacyViewerInviteIds.length) {
            throw new LegacyInvitationReissueConflictError();
          }
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
            inviteeFirstName: inviteProfile.firstName,
            inviteeLastName: inviteProfile.lastName,
            inviteeCompany: inviteProfile.company,
            inviteePhone: inviteProfile.phone,
            inviteeUserType: inviteProfile.userType,
            ndaOnFile: inviteProfile.ndaOnFile,
            ndaOnFileReference: inviteProfile.ndaOnFileReference,
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

        if (assignedRoomIds.length > 0) {
          await tx.invitationRoomAssignment.createMany({
            data: assignedRoomIds.map((roomId) => ({ invitationId: invitation.id, roomId })),
          });
        }

        await tx.event.create({
          data: {
            organizationId: session.organizationId,
            eventType: 'USER_INVITED',
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user.email,
            description: `Invited ${normalizedEmail} to the organization`,
            metadata: {
              role,
              roomCount: assignedRoomIds.length,
              roomIds: assignedRoomIds,
              profileFields: [
                ...(inviteProfile.firstName ? ['firstName'] : []),
                ...(inviteProfile.lastName ? ['lastName'] : []),
                ...(inviteProfile.company ? ['company'] : []),
                ...(inviteProfile.phone ? ['phone'] : []),
                ...(inviteProfile.userType ? ['organizationUserType'] : []),
              ],
              ndaOnFile: inviteProfile.ndaOnFile,
              ndaReferencePresent: Boolean(inviteProfile.ndaOnFileReference),
              ndaReferenceSha256: inviteProfile.ndaOnFileReference
                ? crypto.createHash('sha256').update(inviteProfile.ndaOnFileReference).digest('hex')
                : null,
              reissuedLegacyInvitationCount: legacyViewerInviteIds.length,
              reissuedLegacyInvitationIds: legacyViewerInviteIds,
            },
          },
        });

        // Get organization name + sender identity for the email
        const organization = await tx.organization.findUnique({
          where: { id: session.organizationId },
          select: { name: true, emailSenderName: true, emailSenderAddress: true },
        });

        return {
          invitation,
          organizationName: organization?.name,
          emailSenderName: organization?.emailSenderName ?? null,
          emailSenderAddress: organization?.emailSenderAddress ?? null,
          assignedRoomIds,
        };
      });
    } catch (error) {
      if (error instanceof LegacyInvitationReissueConflictError) {
        return NextResponse.json(
          { error: 'The legacy invitation changed before it could be reissued. Please try again.' },
          { status: 409 }
        );
      }
      throw error;
    }

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { invitation, organizationName, emailSenderName, emailSenderAddress, assignedRoomIds } =
      result;

    // Send invitation email (outside RLS context - email is external)
    try {
      const providers = getProviders();
      const globalSender =
        process.env['ACS_SENDER_ADDRESS'] || process.env['SMTP_FROM'] || 'noreply@vaultspace.org';

      const notificationService = new EmailNotificationService({
        emailProvider: providers.email,
        // Per-org sender identity when configured, else the global default. The
        // per-org address must be a verified ACS sender username (with its
        // display name configured in ACS) to actually deliver.
        fromAddress: emailSenderAddress || globalSender,
        fromName: emailSenderName || organizationName || undefined,
        appUrl: baseUrl,
      });

      const inviter = invitation.invitedByUser;
      const inviterName = inviter
        ? ((inviter.firstName || '') + ' ' + (inviter.lastName || '')).trim() || 'A team member'
        : 'A team member';

      await notificationService.sendInvitationEmail({
        email: normalizedEmail,
        inviterName,
        organizationName: organizationName || 'your organization',
        role,
        invitationUrl,
        expiresAt,
      });
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
          roomCount: assignedRoomIds.length,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
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
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[InviteAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 });
  }
}
