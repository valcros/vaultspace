/**
 * Registration API (F004)
 *
 * POST /api/auth/register - Create new user account
 *
 * Two paths:
 *  - INVITED (valid inviteToken): the invitation is the vetting. Create the user
 *    already verified, join the invited org, sign in. Unchanged UX.
 *  - SELF-SERVICE (no invite): gated by email verification. Create ONLY a pending
 *    (unverified) user + a verification token; do NOT create an organization,
 *    membership, or session until the email is verified (see verify-email route).
 *    The response is privacy-neutral and time-normalized so it cannot be used to
 *    enumerate which emails already have accounts.
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';

import { createSession } from '@/lib/auth';
import { bootstrapDb as db, setTransactionOrganizationContext } from '@/lib/db';
import { sendEmailVerificationEmail } from '@/lib/auth/emailVerificationDelivery';
import {
  enqueueEmailVerificationDelivery,
  issueEmailVerificationDelivery,
} from '@/lib/auth/emailVerificationDeliveryFlow';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { getRequestContext, setSessionCookie, rateLimiters } from '@/lib/middleware';
import { SESSION_CONFIG } from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';
import { z } from 'zod';

const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  inviteToken: z.string().optional(),
  title: z.string().max(255).optional(),
  relationship: z.string().max(50).optional(),
});

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
// Normalize self-service response time so "email already exists" (fast) is
// indistinguishable from "new pending user" (slow, includes bcrypt).
const MINIMUM_SELF_SERVICE_RESPONSE_MS = 350;

function emailFingerprint(normalizedEmail: string): string {
  return createHmac('sha256', process.env['SESSION_SECRET'] || '')
    .update(`vaultspace/email-verification-resend\0${normalizedEmail}`, 'utf8')
    .digest('hex');
}

class InvitationRoomAssignmentUnavailableError extends Error {}
class InvitationAlreadyUsedError extends Error {}
class InvitationExpiredError extends Error {}

async function neutralVerificationResponse(startedAt: number): Promise<NextResponse> {
  const remaining = MINIMUM_SELF_SERVICE_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return NextResponse.json({ status: 'verification_sent' }, { status: 201 });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await request.json();
    const { firstName, lastName, email, password, inviteToken, title, relationship } =
      registerSchema.parse(body);
    const reqContext = getRequestContext(request);
    const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
    const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

    const normalizedEmail = email.toLowerCase();

    // Faucet control: rate-limit registration attempts per IP (fail-closed).
    if (ipAddress) {
      await rateLimiters.registrationByIp(ipAddress);
    }

    // ----- INVITED PATH: vetted by the invitation; create verified + sign in -----
    if (inviteToken) {
      const invitation = await db.invitation.findUnique({
        where: { invitationToken: inviteToken },
        include: { organization: true, roomAssignments: { select: { roomId: true } } },
      });

      if (!invitation) {
        return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 });
      }
      if (invitation.expiresAt < new Date()) {
        return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
      }
      if (invitation.status !== 'PENDING') {
        return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 });
      }
      if (invitation.email.toLowerCase() !== normalizedEmail) {
        return NextResponse.json({ error: 'Email does not match invitation' }, { status: 400 });
      }

      const existingUser = await db.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const organizationId = invitation.organizationId;
      const role = invitation.role as 'ADMIN' | 'VIEWER';
      const assignedRoomIds = (invitation.roomAssignments ?? []).map(
        (assignment) => assignment.roomId
      );

      // A legacy viewer invitation has no persisted room assignment. Accepting
      // it would recreate the reported empty-room failure, so preserve the
      // pending invitation and require an administrator to reissue it safely.
      if (role === 'VIEWER' && assignedRoomIds.length === 0) {
        return NextResponse.json(
          {
            error:
              'This viewer invitation must be reissued with room access before it can be accepted',
          },
          { status: 409 }
        );
      }

      let result: {
        user: { id: string; email: string; firstName: string; lastName: string };
        organization: { id: string; name: string; slug: string };
      };
      try {
        result = await db.$transaction(
          async (tx) => {
            const user = await tx.user.create({
              data: {
                email: normalizedEmail,
                passwordHash,
                firstName,
                lastName,
                title: title || null,
                relationship: relationship || null,
                isActive: true,
                // Invitation possession is the vetting for this sprint's scope.
                emailVerifiedAt: new Date(),
              },
            });

            await tx.userOrganization.create({
              data: { userId: user.id, organizationId, role, isActive: true },
            });

            // The bootstrap policies allow the new identity and membership to
            // be created without tenant context. Every subsequent resource
            // mutation must run under the invited organization, including the
            // new permission grant, because production forces RLS for owners.
            await setTransactionOrganizationContext(tx, organizationId);

            // Load the assignments only after the transaction is scoped to the
            // invited tenant. This prevents a future assignment-management
            // surface from changing the invite between token validation and the
            // direct permission grants below.
            const currentInvitation = await tx.invitation.findUnique({
              where: { id: invitation.id },
              include: { roomAssignments: { select: { roomId: true } } },
            });
            if (!currentInvitation || currentInvitation.status !== 'PENDING') {
              throw new InvitationAlreadyUsedError();
            }
            if (currentInvitation.expiresAt < new Date()) {
              throw new InvitationExpiredError();
            }
            const currentAssignedRoomIds = currentInvitation.roomAssignments.map(
              (assignment) => assignment.roomId
            );
            if (role === 'VIEWER' && currentAssignedRoomIds.length === 0) {
              throw new InvitationRoomAssignmentUnavailableError();
            }

            // Revalidate in the acceptance transaction. A room can be archived or
            // deleted after the invite is issued; consuming the invitation in that
            // state would recreate the empty-room incident.
            if (currentAssignedRoomIds.length > 0) {
              const activeAssignedRooms = await tx.room.findMany({
                where: {
                  id: { in: currentAssignedRoomIds },
                  organizationId,
                  status: 'ACTIVE',
                },
                select: { id: true },
              });
              if (activeAssignedRooms.length !== currentAssignedRoomIds.length) {
                throw new InvitationRoomAssignmentUnavailableError();
              }
            }

            // Guarded acceptance: only flips a still-PENDING invitation. If a
            // concurrent request already accepted it, this matches no row and
            // Prisma throws P2025 (handled below as a deterministic 400).
            await tx.invitation.update({
              where: { id: invitation.id, status: 'PENDING' },
              data: { status: 'ACCEPTED', acceptedAt: new Date() },
            });

            if (currentAssignedRoomIds.length > 0) {
              await tx.permission.createMany({
                data: currentAssignedRoomIds.map((roomId) => ({
                  organizationId,
                  resourceType: 'ROOM' as const,
                  roomId,
                  granteeType: 'USER' as const,
                  userId: user.id,
                  permissionLevel: 'VIEW' as const,
                  grantedByUserId: invitation.invitedByUserId,
                })),
              });
            }

            await tx.event.create({
              data: {
                organizationId,
                eventType: 'USER_ACCEPTED_INVITATION',
                actorType: role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
                actorId: user.id,
                actorEmail: user.email,
                description: 'User registered via invitation',
                metadata: {
                  role,
                  roomCount: currentAssignedRoomIds.length,
                  roomIds: currentAssignedRoomIds,
                },
              },
            });

            return { user, organization: invitation.organization };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (txError) {
        if (txError instanceof InvitationAlreadyUsedError) {
          return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 });
        }
        if (txError instanceof InvitationExpiredError) {
          return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
        }
        if (txError instanceof InvitationRoomAssignmentUnavailableError) {
          return NextResponse.json(
            {
              error:
                'One or more assigned rooms are no longer available. Ask an administrator to reissue the invitation.',
            },
            { status: 409 }
          );
        }
        if (
          txError &&
          typeof txError === 'object' &&
          'code' in txError &&
          (txError as { code?: string }).code === 'P2034'
        ) {
          return NextResponse.json(
            { error: 'Invitation acceptance conflicted with a room update. Please try again.' },
            { status: 409 }
          );
        }
        if (
          txError &&
          typeof txError === 'object' &&
          'code' in txError &&
          (txError as { code?: string }).code === 'P2002'
        ) {
          return NextResponse.json(
            { error: 'An account with this email already exists or this invitation was accepted' },
            { status: 409 }
          );
        }
        if (
          txError &&
          typeof txError === 'object' &&
          'code' in txError &&
          (txError as { code?: string }).code === 'P2025'
        ) {
          return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 });
        }
        throw txError;
      }

      const expiresAt = new Date(
        Date.now() + SESSION_CONFIG.DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000
      );
      const { session: authSession, token: sessionToken } = await createSession(
        result.user.id,
        organizationId,
        { expiresAt, ipAddress, userAgent }
      );
      await setSessionCookie(sessionToken, expiresAt);

      await captureAccessAudit({
        organizationId,
        eventType: 'USER_LOGIN',
        actorType: role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
        actorId: result.user.id,
        actorEmail: result.user.email,
        requestId: reqContext.requestId,
        description: 'User registered via invitation and signed in',
        metadata: { authSessionId: authSession.id, authenticationMethod: 'REGISTRATION' },
        ipAddress,
        userAgent,
      });

      return NextResponse.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          slug: result.organization.slug,
        },
      });
    }

    // ----- SELF-SERVICE PATH: email-verification gated, deferred org creation -----
    // No organization, membership, or session is created here. The organization
    // is created only when the email is verified (see /api/auth/verify-email).
    //
    // Apply the recipient throttle before account lookup. Applying it only to a
    // known pending account would make rate-limit behavior an enumeration oracle.
    await rateLimiters.emailVerificationResendByEmailFingerprint(emailFingerprint(normalizedEmail));

    // Compute the password hash UNCONDITIONALLY, before the existence lookup, so
    // bcrypt cost (the dominant work) does not vary by whether the email already
    // exists. This is BEST-EFFORT timing normalization (paired with the response
    // pad and non-awaited email delivery below), not a strict guarantee: the
    // new/pending branches still perform a couple of DB writes the verified/
    // unknown branches skip. Strict account-existence privacy would require
    // moving issuance onto a durable async workflow.
    const passwordHash = await bcrypt.hash(password, 12);

    let account = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, emailVerifiedAt: true, firstName: true },
    });

    if (!account) {
      try {
        const created = await db.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            firstName,
            lastName,
            title: title || null,
            relationship: relationship || null,
            isActive: true,
            emailVerifiedAt: null,
          },
          select: { id: true, emailVerifiedAt: true, firstName: true },
        });
        account = created;
      } catch (createError) {
        // Concurrent registration for the same new email: the unique(email)
        // constraint fires (Prisma P2002) for the loser. Treat it as a normal
        // race — re-read and fall through to the identical neutral response.
        // (Returning 500 here would leak account existence: new email => one
        // 201 + one 500, distinguishable from an existing email => two 201s.)
        if (
          createError &&
          typeof createError === 'object' &&
          'code' in createError &&
          (createError as { code?: string }).code === 'P2002'
        ) {
          account = await db.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, emailVerifiedAt: true, firstName: true },
          });
        } else {
          throw createError;
        }
      }
    }

    let pendingUserId: string | null = null;
    let firstNameForEmail = firstName;

    // Issue a token only for a pending (unverified) account — whether freshly
    // created, retrying, or observed via the concurrent-create re-read. A
    // verified account (or a vanished row) issues nothing but returns the same
    // neutral response.
    if (account && account.emailVerifiedAt === null) {
      pendingUserId = account.id;
      firstNameForEmail = account.firstName;
    }

    if (pendingUserId) {
      const issued = await issueEmailVerificationDelivery({
        userId: pendingUserId,
        email: normalizedEmail,
        requestId: reqContext.requestId,
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      });
      if (issued.mode === 'durable') {
        // The database commit is authoritative. Queue failures are persisted
        // by the enqueue helper and recovered by the scheduled reconciler.
        void enqueueEmailVerificationDelivery(issued.flowId);
      } else {
        // Compatibility-only rollout path. It is removed once durable mode is
        // enabled in every deployment after migration/key/worker validation.
        void sendEmailVerificationEmail({
          to: normalizedEmail,
          firstName: firstNameForEmail,
          publicToken: issued.publicToken,
        }).catch(() => {
          console.error(
            JSON.stringify({
              component: 'email-verification-delivery',
              event: 'legacy_submission',
              outcome: 'failed',
              requestId: reqContext.requestId,
              errorCode: 'EMAIL_PROVIDER_ERROR',
            })
          );
        });
      }
    }

    return await neutralVerificationResponse(startedAt);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error('[RegisterAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
