import { createHmac, randomBytes } from 'node:crypto';
import { Prisma, type AccountSwitchSession } from '@prisma/client';
import { cookies, headers } from 'next/headers';

import { createSession, clearSessionCache, type SessionData } from '@/lib/auth';
import { bootstrapRepository } from '@/lib/auth/bootstrapRepository';
import { verifyPassword } from '@/lib/auth/password';
import { SESSION_CONFIG } from '@/lib/constants';
import { bootstrapDb } from '@/lib/db';
import { AuthorizationError } from '@/lib/errors';
import { verifyTOTP } from '@/lib/totp';
import { getTrustedClientIp, getTrustedIpSubnet, hashUserAgent } from '@/lib/utils/ip';
import {
  revokeSysopSessionsForTenantSession,
  SYSOP_COOKIE_NAME,
} from '@/lib/sysop/platformSession';

export const SWITCH_COOKIE_NAME = 'vaultspace-account-switch';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE_MS = 30 * 60 * 1000;
const IDLE_AGE_MS = 10 * 60 * 1000;

export interface AccountSummary {
  userId: string;
  email: string;
  organizationName: string | null;
  isCurrent: boolean;
  isPrimary: boolean;
  available: boolean;
  linkId: string | null;
}

function tokenHash(token: string): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    throw new Error('SESSION_SECRET is required for account switching');
  }
  return createHmac('sha256', secret)
    .update('vaultspace-account-switch:v1:')
    .update(token)
    .digest('hex');
}

function primaryMfaKeyHash(mfaSecret: string): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    throw new Error('SESSION_SECRET is required for account switching');
  }
  return createHmac('sha256', secret)
    .update('vaultspace-account-switch-mfa:v1:')
    .update(mfaSecret)
    .digest('hex');
}

async function networkContext() {
  const requestHeaders = await headers();
  const ipAddress = getTrustedClientIp(requestHeaders);
  return {
    ipAddress,
    ipSubnet: getTrustedIpSubnet(ipAddress),
    userAgent: requestHeaders.get('user-agent'),
    userAgentHash: hashUserAgent(requestHeaders.get('user-agent')),
  };
}

async function auditDenied(actorUserId: string, requestId: string, reasonCode: string) {
  await bootstrapDb.platformAuditEvent.create({
    data: {
      action: 'ACCOUNT_SWITCH_DENIED',
      outcome: 'DENIED',
      actorUserId,
      requestId,
      reasonCode,
    },
  });
}

async function verifyPrimaryProof(session: SessionData, password: string, code: string) {
  const primary = await bootstrapDb.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  if (
    !primary?.isActive ||
    !primary.twoFactorEnabled ||
    !primary.twoFactorSecret ||
    !(await verifyPassword(password, primary.passwordHash)) ||
    !verifyTOTP(primary.twoFactorSecret, code)
  ) {
    throw new AuthorizationError('Primary account password and authenticator code are required');
  }
  return primary;
}

async function verifySecondaryProof(email: string, password: string, code: string | undefined) {
  const secondary = await bootstrapDb.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      isActive: true,
      emailVerifiedAt: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  const validPassword = secondary ? await verifyPassword(password, secondary.passwordHash) : false;
  const validMfa =
    !secondary?.twoFactorEnabled ||
    (Boolean(secondary.twoFactorSecret) &&
      Boolean(code) &&
      verifyTOTP(secondary.twoFactorSecret!, code!));
  if (!secondary?.isActive || !secondary.emailVerifiedAt || !validPassword || !validMfa) {
    throw new AuthorizationError('Could not verify the secondary account');
  }
  const candidate = await bootstrapRepository.findLoginCandidate(secondary.email);
  if (!candidate || candidate.userId !== secondary.id || !candidate.userIsActive) {
    throw new AuthorizationError('Could not verify the secondary account');
  }
  return secondary;
}

export async function createAccountLink(
  session: SessionData,
  input: {
    primaryPassword: string;
    primaryCode: string;
    secondaryEmail: string;
    secondaryPassword: string;
    secondaryCode?: string;
  },
  requestId: string
) {
  try {
    await verifyPrimaryProof(session, input.primaryPassword, input.primaryCode);
    const secondary = await verifySecondaryProof(
      input.secondaryEmail,
      input.secondaryPassword,
      input.secondaryCode
    );
    if (secondary.id === session.userId) {
      throw new AuthorizationError('An account cannot be linked to itself');
    }

    return await bootstrapDb.$transaction(async (tx) => {
      // Ordered locks prevent reciprocal or cross-group links racing each other.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM public.users
        WHERE id = ${session.userId}::text OR id = ${secondary.id}::text
        ORDER BY id FOR UPDATE
      `);
      const [primaryAlreadySecondary, secondaryAlreadyLinked, secondaryIsPrimary] =
        await Promise.all([
          tx.accountLink.findUnique({ where: { secondaryUserId: session.userId } }),
          tx.accountLink.findUnique({ where: { secondaryUserId: secondary.id } }),
          tx.accountLink.findFirst({ where: { primaryUserId: secondary.id } }),
        ]);
      if (primaryAlreadySecondary || secondaryAlreadyLinked || secondaryIsPrimary) {
        throw new AuthorizationError('Account is already part of an account group');
      }
      const link = await tx.accountLink.create({
        data: {
          primaryUserId: session.userId,
          secondaryUserId: secondary.id,
          verifiedAt: new Date(),
        },
      });
      await tx.platformAuditEvent.create({
        data: {
          action: 'ACCOUNT_LINKED',
          actorUserId: session.userId,
          targetUserId: secondary.id,
          requestId,
          reasonCode: 'VERIFIED_CREDENTIALS',
          authStrength: 'MFA',
          nextState: 'LINKED',
        },
      });
      return { id: link.id, email: secondary.email };
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      await auditDenied(session.userId, requestId, 'LINK_PROOF_DENIED');
    }
    throw error;
  }
}

export async function removeAccountLink(
  session: SessionData,
  linkId: string,
  password: string,
  code: string,
  requestId: string
): Promise<void> {
  try {
    await verifyPrimaryProof(session, password, code);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      await auditDenied(session.userId, requestId, 'UNLINK_PROOF_DENIED');
    }
    throw error;
  }
  await bootstrapDb.$transaction(async (tx) => {
    const link = await tx.accountLink.findFirst({
      where: { id: linkId, primaryUserId: session.userId },
    });
    if (!link) {
      throw new AuthorizationError('Linked account not found');
    }
    await tx.accountLink.delete({ where: { id: link.id } });
    const grants = await tx.accountSwitchSession.findMany({
      where: { primaryUserId: session.userId, isActive: true },
      select: { id: true },
    });
    for (const grant of grants) {
      await tx.accountSwitchSession.update({ where: { id: grant.id }, data: { isActive: false } });
      await tx.platformAuditEvent.create({
        data: {
          action: 'ACCOUNT_SWITCH_SESSION_ENDED',
          actorUserId: session.userId,
          requestId,
          correlationId: grant.id,
          reasonCode: 'ACCOUNT_UNLINKED',
          previousState: 'ACTIVE',
          nextState: 'ENDED',
        },
      });
    }
    await tx.platformAuditEvent.create({
      data: {
        action: 'ACCOUNT_UNLINKED',
        actorUserId: session.userId,
        targetUserId: link.secondaryUserId,
        requestId,
        previousState: 'LINKED',
        nextState: 'UNLINKED',
        authStrength: 'MFA',
      },
    });
  });
  (await cookies()).delete(SWITCH_COOKIE_NAME);
}

export async function getActiveSwitchSession(
  session: SessionData
): Promise<AccountSwitchSession | null> {
  const token = (await cookies()).get(SWITCH_COOKIE_NAME)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  const grant = await bootstrapDb.accountSwitchSession.findUnique({
    where: { tokenHash: tokenHash(token) },
  });
  if (
    !grant?.isActive ||
    grant.currentUserId !== session.userId ||
    grant.currentTenantSessionId !== session.sessionId
  ) {
    return null;
  }
  const network = await networkContext();
  if (grant.ipSubnet !== network.ipSubnet || grant.userAgentHash !== network.userAgentHash) {
    return null;
  }
  const primary = await bootstrapDb.user.findUnique({
    where: { id: grant.primaryUserId },
    select: { isActive: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (
    !primary?.isActive ||
    !primary.twoFactorEnabled ||
    !primary.twoFactorSecret ||
    primaryMfaKeyHash(primary.twoFactorSecret) !== grant.primaryMfaKeyHash
  ) {
    await bootstrapDb.$transaction(async (tx) => {
      const ended = await tx.accountSwitchSession.updateMany({
        where: { id: grant.id, isActive: true },
        data: { isActive: false },
      });
      if (ended.count) {
        await tx.platformAuditEvent.create({
          data: {
            action: 'ACCOUNT_SWITCH_SESSION_ENDED',
            actorUserId: session.userId,
            requestId: `switch_mfa_revoked_${grant.id}`,
            correlationId: grant.id,
            reasonCode: 'PRIMARY_MFA_REVOKED',
            previousState: 'ACTIVE',
            nextState: 'ENDED',
          },
        });
      }
    });
    return null;
  }
  const now = new Date();
  if (grant.expiresAt <= now || now.getTime() - grant.lastActiveAt.getTime() >= IDLE_AGE_MS) {
    await bootstrapDb.$transaction(async (tx) => {
      const ended = await tx.accountSwitchSession.updateMany({
        where: { id: grant.id, isActive: true },
        data: { isActive: false },
      });
      if (ended.count) {
        await tx.platformAuditEvent.create({
          data: {
            action: 'ACCOUNT_SWITCH_SESSION_EXPIRED',
            actorUserId: session.userId,
            requestId: `switch_expire_${grant.id}`,
            correlationId: grant.id,
            previousState: 'ACTIVE',
            nextState: 'EXPIRED',
          },
        });
      }
    });
    return null;
  }
  return grant;
}

export async function listAccountLinks(session: SessionData) {
  const switchGrant = await getActiveSwitchSession(session);
  const isSecondary = await bootstrapDb.accountLink.findUnique({
    where: { secondaryUserId: session.userId },
    select: { primaryUserId: true },
  });
  const isPrimary = !isSecondary;
  const primaryUserId = isSecondary?.primaryUserId ?? session.userId;
  if (isSecondary && !switchGrant) {
    return {
      isPrimary: false,
      switchingActive: false,
      expiresAt: null,
      accounts: [
        {
          userId: session.userId,
          email: session.user.email,
          organizationName: session.organization.name,
          isCurrent: true,
          isPrimary: false,
          available: true,
          linkId: null,
        },
      ] satisfies AccountSummary[],
    };
  }

  const [primary, links] = await Promise.all([
    bootstrapDb.user.findUnique({
      where: { id: primaryUserId },
      select: { id: true, email: true },
    }),
    bootstrapDb.accountLink.findMany({
      where: { primaryUserId },
      include: { secondary: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  if (!primary) {
    throw new AuthorizationError('Primary account unavailable');
  }
  const members = [
    { id: primary.id, email: primary.email, linkId: null },
    ...links.map((link) => ({
      id: link.secondary.id,
      email: link.secondary.email,
      linkId: link.id,
    })),
  ];
  const accounts: AccountSummary[] = await Promise.all(
    members.map(async (member) => {
      const candidate = await bootstrapRepository.findLoginCandidate(member.email);
      return {
        userId: member.id,
        email: member.email,
        organizationName: candidate?.organizationName ?? null,
        isCurrent: member.id === session.userId,
        isPrimary: member.id === primary.id,
        available: Boolean(candidate && candidate.userId === member.id && candidate.userIsActive),
        linkId: member.linkId,
      };
    })
  );
  return {
    isPrimary,
    switchingActive: Boolean(switchGrant),
    expiresAt: switchGrant?.expiresAt ?? null,
    accounts,
  };
}

export async function startAccountSwitching(
  session: SessionData,
  password: string,
  code: string,
  requestId: string
): Promise<Date> {
  let primary: Awaited<ReturnType<typeof verifyPrimaryProof>>;
  try {
    primary = await verifyPrimaryProof(session, password, code);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      await auditDenied(session.userId, requestId, 'START_PROOF_DENIED');
    }
    throw error;
  }
  const secondaryGroup = await bootstrapDb.accountLink.findUnique({
    where: { secondaryUserId: session.userId },
    select: { id: true },
  });
  if (secondaryGroup) {
    await auditDenied(session.userId, requestId, 'SECONDARY_CANNOT_START');
    throw new AuthorizationError('Sign in to the primary account first');
  }
  const linkCount = await bootstrapDb.accountLink.count({
    where: { primaryUserId: session.userId },
  });
  if (linkCount < 1) {
    await auditDenied(session.userId, requestId, 'NO_LINKED_ACCOUNTS');
    throw new AuthorizationError('Link an account before switching');
  }

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_AGE_MS);
  const network = await networkContext();
  if (!network.ipSubnet) {
    await auditDenied(session.userId, requestId, 'NETWORK_UNVERIFIED');
    throw new AuthorizationError('A trusted network address is required for account switching');
  }
  await bootstrapDb.$transaction(async (tx) => {
    const prior = await tx.accountSwitchSession.findMany({
      where: { primaryUserId: session.userId, isActive: true },
      select: { id: true },
    });
    for (const grant of prior) {
      await tx.accountSwitchSession.update({ where: { id: grant.id }, data: { isActive: false } });
      await tx.platformAuditEvent.create({
        data: {
          action: 'ACCOUNT_SWITCH_SESSION_ENDED',
          actorUserId: session.userId,
          requestId,
          correlationId: grant.id,
          reasonCode: 'REPLACED',
          previousState: 'ACTIVE',
          nextState: 'ENDED',
        },
      });
    }
    const grant = await tx.accountSwitchSession.create({
      data: {
        primaryUserId: session.userId,
        currentUserId: session.userId,
        currentTenantSessionId: session.sessionId,
        tokenHash: tokenHash(token),
        expiresAt,
        mfaVerifiedAt: now,
        primaryMfaKeyHash: primaryMfaKeyHash(primary.twoFactorSecret!),
        ipSubnet: network.ipSubnet,
        userAgentHash: network.userAgentHash,
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        action: 'ACCOUNT_SWITCH_SESSION_STARTED',
        actorUserId: session.userId,
        requestId,
        correlationId: grant.id,
        authStrength: 'MFA',
        nextState: 'ACTIVE',
      },
    });
  });
  (await cookies()).set(SWITCH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
  return expiresAt;
}

export async function stopAccountSwitching(
  session: Pick<SessionData, 'userId' | 'sessionId'>,
  requestId: string
): Promise<void> {
  await bootstrapDb.$transaction(async (tx) => {
    const active = await tx.accountSwitchSession.findMany({
      where: {
        currentUserId: session.userId,
        currentTenantSessionId: session.sessionId,
        isActive: true,
      },
      select: { id: true },
    });
    for (const grant of active) {
      await tx.accountSwitchSession.update({ where: { id: grant.id }, data: { isActive: false } });
      await tx.platformAuditEvent.create({
        data: {
          action: 'ACCOUNT_SWITCH_SESSION_ENDED',
          actorUserId: session.userId,
          requestId,
          correlationId: grant.id,
          previousState: 'ACTIVE',
          nextState: 'ENDED',
        },
      });
    }
  });
  (await cookies()).delete(SWITCH_COOKIE_NAME);
}

/** A credential or MFA change ends every switching window involving the user. */
export async function revokeAccountSwitchSessionsForUser(userId: string, requestId: string) {
  const secondaryLink = await bootstrapDb.accountLink.findUnique({
    where: { secondaryUserId: userId },
    select: { primaryUserId: true },
  });
  await bootstrapDb.$transaction(async (tx) => {
    const grants = await tx.accountSwitchSession.findMany({
      where: {
        isActive: true,
        OR: [
          { primaryUserId: userId },
          { currentUserId: userId },
          ...(secondaryLink ? [{ primaryUserId: secondaryLink.primaryUserId }] : []),
        ],
      },
      select: { id: true },
    });
    for (const grant of grants) {
      await tx.accountSwitchSession.update({ where: { id: grant.id }, data: { isActive: false } });
      await tx.platformAuditEvent.create({
        data: {
          action: 'ACCOUNT_SWITCH_SESSION_ENDED',
          actorUserId: userId,
          requestId,
          correlationId: grant.id,
          reasonCode: 'CREDENTIAL_CHANGED',
          previousState: 'ACTIVE',
          nextState: 'ENDED',
        },
      });
    }
  });
}

export async function switchAccount(
  session: SessionData,
  targetUserId: string,
  requestId: string
): Promise<{ email: string; organizationName: string }> {
  const grant = await getActiveSwitchSession(session);
  if (!grant) {
    await auditDenied(session.userId, requestId, 'SWITCH_GRANT_REQUIRED');
    throw new AuthorizationError('Start switching from the primary account first');
  }
  if (targetUserId === session.userId) {
    throw new AuthorizationError('Already using this account');
  }
  if (targetUserId !== grant.primaryUserId) {
    const authorizedLink = await bootstrapDb.accountLink.findFirst({
      where: { primaryUserId: grant.primaryUserId, secondaryUserId: targetUserId },
      select: { id: true },
    });
    if (!authorizedLink) {
      await auditDenied(session.userId, requestId, 'TARGET_NOT_LINKED');
      throw new AuthorizationError('Account unavailable');
    }
  }
  const target = await bootstrapDb.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, isActive: true },
  });
  if (!target?.isActive) {
    throw new AuthorizationError('Account unavailable');
  }
  const candidate = await bootstrapRepository.findLoginCandidate(target.email);
  if (!candidate || candidate.userId !== target.id || !candidate.userIsActive) {
    throw new AuthorizationError('Account has no active organization');
  }
  const network = await networkContext();
  await revokeSysopSessionsForTenantSession(session, requestId);
  const now = new Date();
  const newSession = await bootstrapDb.$transaction(async (tx) => {
    if (target.id !== grant.primaryUserId) {
      const link = await tx.accountLink.findFirst({
        where: { primaryUserId: grant.primaryUserId, secondaryUserId: target.id },
        select: { id: true },
      });
      if (!link) {
        throw new AuthorizationError('Account is no longer linked');
      }
    }
    const issued = await createSession(
      target.id,
      candidate.organizationId,
      {
        ipAddress: network.ipAddress,
        userAgent: network.userAgent,
        expiresAt: new Date(now.getTime() + SESSION_CONFIG.DEFAULT_DURATION_DAYS * 86_400_000),
      },
      tx
    );
    const moved = await tx.accountSwitchSession.updateMany({
      where: {
        id: grant.id,
        isActive: true,
        currentUserId: session.userId,
        currentTenantSessionId: session.sessionId,
        expiresAt: { gt: now },
        lastActiveAt: { gt: new Date(now.getTime() - IDLE_AGE_MS) },
      },
      data: {
        currentUserId: target.id,
        currentTenantSessionId: issued.session.id,
        lastActiveAt: now,
      },
    });
    if (moved.count !== 1) {
      throw new AuthorizationError('Switching window expired');
    }
    const revoked = await tx.session.updateMany({
      where: { id: session.sessionId, userId: session.userId, isActive: true },
      data: { isActive: false },
    });
    if (revoked.count !== 1) {
      throw new AuthorizationError('Current session is no longer active');
    }
    await tx.platformAuditEvent.create({
      data: {
        action: 'ACCOUNT_SWITCHED',
        actorUserId: session.userId,
        targetUserId: target.id,
        targetOrgId: candidate.organizationId,
        requestId,
        correlationId: grant.id,
        previousState: 'ACTIVE',
        nextState: 'ACTIVE',
        authStrength: 'PRIMARY_MFA',
      },
    });
    return issued;
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_CONFIG.COOKIE_NAME, newSession.token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    expires: newSession.session.expiresAt,
  });
  cookieStore.delete(SYSOP_COOKIE_NAME);
  try {
    await clearSessionCache([session.sessionId]);
  } catch {
    // validateSession always checks the database projection before its cache.
    // A cache outage cannot restore the revoked old tenant session.
  }
  return { email: target.email, organizationName: candidate.organizationName };
}
