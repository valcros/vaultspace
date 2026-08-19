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

import { createSession } from '@/lib/auth';
import { bootstrapDb as db } from '@/lib/db';
import { createEmailVerificationToken } from '@/lib/auth/emailVerificationToken';
import { sendEmailVerificationEmail } from '@/lib/auth/emailVerificationDelivery';
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
        include: { organization: true },
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

      let result: {
        user: { id: string; email: string; firstName: string; lastName: string };
        organization: { id: string; name: string; slug: string };
      };
      try {
        result = await db.$transaction(async (tx) => {
          // Guarded acceptance: only flips a still-PENDING invitation. If a
          // concurrent request already accepted it, this matches no row and
          // Prisma throws P2025 (handled below as a deterministic 400).
          await tx.invitation.update({
            where: { id: invitation.id, status: 'PENDING' },
            data: { status: 'ACCEPTED', acceptedAt: new Date() },
          });

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

          return { user, organization: invitation.organization };
        });
      } catch (txError) {
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
    // Compute the password hash UNCONDITIONALLY, before the existence lookup, so
    // bcrypt cost (the dominant work) does not vary by whether the email already
    // exists — otherwise response time leaks account existence.
    const passwordHash = await bcrypt.hash(password, 12);

    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, emailVerifiedAt: true, firstName: true },
    });

    let pendingUserId: string | null = null;
    let firstNameForEmail = firstName;

    if (!existingUser) {
      const user = await db.user.create({
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
      });
      pendingUserId = user.id;
    } else if (existingUser.emailVerifiedAt === null) {
      // A pending (unverified) account is retrying registration — re-send.
      pendingUserId = existingUser.id;
      firstNameForEmail = existingUser.firstName;
    }
    // else: a verified account already exists. Do nothing, but still return the
    // identical neutral response below (no enumeration).

    if (pendingUserId) {
      const { publicToken, storedToken } = createEmailVerificationToken();
      await db.emailVerificationToken.create({
        data: {
          userId: pendingUserId,
          token: storedToken,
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        },
      });
      // Fire-and-forget: do NOT await email-provider latency inside the response
      // path — that latency (present only for new/pending branches) would
      // differentiate timing and leak account existence. Failures are logged;
      // the resend endpoint is the recovery path.
      void sendEmailVerificationEmail({
        to: normalizedEmail,
        firstName: firstNameForEmail,
        publicToken,
      }).catch((sendError) => {
        console.error('[RegisterAPI] Verification email send failed:', sendError);
      });
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
