import { createHmac, randomBytes } from 'node:crypto';
import type { PlatformSession } from '@prisma/client';
import { cookies, headers } from 'next/headers';

import type { SessionData } from '@/lib/auth';
import { bootstrapDb } from '@/lib/db';
import { AuthorizationError } from '@/lib/errors';
import { verifyTOTP } from '@/lib/totp';
import { getClientIp, getIpSubnet, hashUserAgent } from '@/lib/utils/ip';
import { SysopIpAllowlistService } from './ipAllowlist';

export const SYSOP_COOKIE_NAME = 'vaultspace-sysop';
const MAX_AGE_MS = 30 * 60 * 1000;
const IDLE_AGE_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type SysopReason = 'PLATFORM_MAINTENANCE' | 'SUPPORT' | 'INCIDENT';

async function auditDenied(userId: string, requestId: string, reasonCode: string) {
  await bootstrapDb.platformAuditEvent.create({
    data: {
      action: 'SYSOP_ACTION_DENIED',
      outcome: 'DENIED',
      actorUserId: userId,
      requestId,
      reasonCode,
      authStrength: 'PASSWORD',
    },
  });
}

function tokenHash(token: string): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    throw new Error('SESSION_SECRET is required for SysOp sessions');
  }
  return createHmac('sha256', secret).update('vaultspace-sysop:v1:').update(token).digest('hex');
}

async function networkContext() {
  const requestHeaders = await headers();
  const ipAddress = getClientIp(requestHeaders);
  const userAgentHash = hashUserAgent(requestHeaders.get('user-agent'));
  return {
    ipAddress,
    ipSubnet: getIpSubnet(ipAddress),
    userAgentHash,
  };
}

export async function requireSysopEligibility(session: SessionData): Promise<void> {
  const user = await bootstrapDb.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, isPlatformOperator: true },
  });
  if (!user?.isActive || !user.isPlatformOperator) {
    throw new AuthorizationError('Platform operator access required');
  }
  const { ipAddress } = await networkContext();
  const ipCheck = await SysopIpAllowlistService.isClientIpAllowed(ipAddress);
  if (!ipCheck.allowed) {
    throw new AuthorizationError('Platform access policy denied this network');
  }
}

function matchesBinding(
  platform: PlatformSession,
  tenant: SessionData,
  network: Awaited<ReturnType<typeof networkContext>>
): boolean {
  return (
    platform.userId === tenant.userId &&
    platform.tenantSessionId === tenant.sessionId &&
    (!platform.ipSubnet || platform.ipSubnet === network.ipSubnet) &&
    (!platform.userAgentHash || platform.userAgentHash === network.userAgentHash)
  );
}

export async function getActiveSysopSession(tenant: SessionData): Promise<PlatformSession | null> {
  const cookie = (await cookies()).get(SYSOP_COOKIE_NAME)?.value;
  if (!cookie || !TOKEN_PATTERN.test(cookie)) {
    return null;
  }
  const network = await networkContext();
  const platform = await bootstrapDb.platformSession.findUnique({
    where: { tokenHash: tokenHash(cookie) },
  });
  if (!platform || !platform.isActive || !matchesBinding(platform, tenant, network)) {
    return null;
  }
  const now = new Date();
  if (platform.expiresAt <= now || now.getTime() - platform.lastActiveAt.getTime() >= IDLE_AGE_MS) {
    await bootstrapDb.$transaction(async (tx) => {
      const updated = await tx.platformSession.updateMany({
        where: { id: platform.id, isActive: true },
        data: { isActive: false },
      });
      if (updated.count) {
        await tx.platformAuditEvent.create({
          data: {
            action: 'SYSOP_SESSION_EXPIRED',
            actorUserId: tenant.userId,
            platformSessionId: platform.id,
            requestId: `sysop_expire_${platform.id}`,
            previousState: 'ACTIVE',
            nextState: 'EXPIRED',
          },
        });
      }
    });
    return null;
  }
  if (now.getTime() - platform.lastActiveAt.getTime() >= 60_000) {
    await bootstrapDb.platformSession.updateMany({
      where: { id: platform.id, isActive: true },
      data: { lastActiveAt: now },
    });
  }
  return platform;
}

export async function enterSysopMode(
  tenant: SessionData,
  code: string,
  reason: SysopReason,
  requestId: string
): Promise<Date> {
  try {
    await requireSysopEligibility(tenant);
  } catch (error) {
    await auditDenied(tenant.userId, requestId, 'NOT_ELIGIBLE');
    throw error;
  }
  const user = await bootstrapDb.user.findUnique({
    where: { id: tenant.userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    await auditDenied(tenant.userId, requestId, 'MFA_REQUIRED');
    throw new AuthorizationError('Enroll in two-factor authentication before entering SysOp mode');
  }
  if (!verifyTOTP(user.twoFactorSecret, code)) {
    await auditDenied(tenant.userId, requestId, 'MFA_INVALID');
    throw new AuthorizationError('Invalid verification code');
  }

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_AGE_MS);
  const network = await networkContext();
  await bootstrapDb.$transaction(async (tx) => {
    const priorSessions = await tx.platformSession.findMany({
      where: { userId: tenant.userId, tenantSessionId: tenant.sessionId, isActive: true },
      select: { id: true },
    });
    for (const prior of priorSessions) {
      const ended = await tx.platformSession.updateMany({
        where: { id: prior.id, isActive: true },
        data: { isActive: false },
      });
      if (ended.count) {
        await tx.platformAuditEvent.create({
          data: {
            action: 'SYSOP_SESSION_ENDED',
            actorUserId: tenant.userId,
            platformSessionId: prior.id,
            requestId,
            reasonCode: 'REPLACED',
            previousState: 'ACTIVE',
            nextState: 'ENDED',
          },
        });
      }
    }
    const platform = await tx.platformSession.create({
      data: {
        userId: tenant.userId,
        tenantSessionId: tenant.sessionId,
        tokenHash: tokenHash(token),
        expiresAt,
        mfaVerifiedAt: now,
        ipAddress: network.ipAddress,
        ipSubnet: network.ipSubnet,
        userAgentHash: network.userAgentHash,
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        action: 'SYSOP_SESSION_STARTED',
        actorUserId: tenant.userId,
        platformSessionId: platform.id,
        requestId,
        reasonCode: reason,
        nextState: 'ACTIVE',
        authStrength: 'MFA',
        userAgentHash: network.userAgentHash,
      },
    });
  });
  (await cookies()).set(SYSOP_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
  return expiresAt;
}

export async function exitSysopMode(tenant: SessionData, requestId: string): Promise<void> {
  await revokeSysopSessionsForTenantSession(tenant, requestId);
  (await cookies()).delete(SYSOP_COOKIE_NAME);
}

/** Called on explicit exit, logout, credential change, and account switching. */
export async function revokeSysopSessionsForTenantSession(
  tenant: Pick<SessionData, 'userId' | 'sessionId'>,
  requestId: string
): Promise<void> {
  await bootstrapDb.$transaction(async (tx) => {
    const active = await tx.platformSession.findMany({
      where: { userId: tenant.userId, tenantSessionId: tenant.sessionId, isActive: true },
      select: { id: true },
    });
    for (const platform of active) {
      const updated = await tx.platformSession.updateMany({
        where: { id: platform.id, isActive: true },
        data: { isActive: false },
      });
      if (updated.count) {
        await tx.platformAuditEvent.create({
          data: {
            action: 'SYSOP_SESSION_ENDED',
            actorUserId: tenant.userId,
            platformSessionId: platform.id,
            requestId,
            previousState: 'ACTIVE',
            nextState: 'ENDED',
          },
        });
      }
    }
  });
}
