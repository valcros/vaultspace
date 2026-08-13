/**
 * Session Management
 *
 * PostgreSQL-backed sessions with Redis caching for performance.
 * Session tokens are the sole source of truth for authentication.
 */

import type { Prisma, Session } from '@prisma/client';

import { SESSION_CONFIG } from '../constants';
import { db } from '../db';
import { AuthenticationError } from '../errors';
import { getProviders } from '@/providers';

import { BootstrapRepository, type BootstrapSessionProjection } from './bootstrapRepository';
import {
  SessionMutationRepository,
  sessionMutationRepository,
  type SessionMutationQueryClient,
} from './sessionMutationRepository';
import { generateSessionToken } from './token';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: 'ADMIN' | 'VIEWER';
  canManageUsers: boolean;
  canManageRooms: boolean;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  organizationId: string;
  user: SessionUser;
  organization: SessionOrganization;
  expiresAt: Date;
  issuedAt: Date;
}

export interface CreateSessionOptions {
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt?: Date;
}

type SessionMutationClient = Pick<Prisma.TransactionClient, 'session'>;
const bootstrapRepository = new BootstrapRepository();

/**
 * Create a new session for a user
 */
export async function createSession(
  userId: string,
  organizationId: string,
  options: CreateSessionOptions = {},
  client?: SessionMutationQueryClient
): Promise<{ session: Session; token: string }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt =
    options.expiresAt ??
    new Date(now.getTime() + SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60 * 1000);
  const repository = client ? new SessionMutationRepository(client) : sessionMutationRepository;
  const created = await repository.createSession({
    userId,
    organizationId,
    token,
    expiresAt,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  if (!created) {
    throw new Error('BOOTSTRAP_SESSION_CREATE_DENIED');
  }

  const session: Session = {
    id: created.sessionId,
    createdAt: created.createdAt,
    updatedAt: created.createdAt,
    userId,
    organizationId,
    token,
    expiresAt: created.expiresAt,
    lastActiveAt: created.createdAt,
    ipAddress: options.ipAddress ?? null,
    userAgent: options.userAgent ?? null,
    isActive: true,
  };

  // Deliberately NOT cached here: only validateSession writes the cache, and
  // only with a complete membership-checked snapshot. Caching a partial blob
  // at creation was the malformed-cache hazard the read path guards against.

  return { session, token };
}

/**
 * Validate and refresh a session token
 * Returns session data if valid, throws otherwise
 */
// Read-through cache contract:
// - Only validateSession writes the cache, and only with a COMPLETE, versioned
//   SessionData snapshot. Never cache partial data.
// - Cache TTL is short (60s) and independent of the 24h idle window: Redis is
//   an accelerator, never the source of truth for authorization. Any endpoint
//   that mutates membership, role, or user active state MUST deactivate
//   sessions and call clearSessionCache (see reset-password and user delete).
// - Anything unexpected in a cached value falls through to full DB validation
//   (fail closed on the cheap path, never on security).
const SESSION_CACHE_VERSION = 1;
const SESSION_CACHE_TTL_SECONDS = 60;
const ACTIVITY_REFRESH_MIN_MS = 5 * 60 * 1000;

interface CachedSessionEnvelope {
  v: number;
  data: SessionData;
}

function reviveCachedSession(raw: unknown): SessionData | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const envelope = raw as Partial<CachedSessionEnvelope>;
  if (envelope.v !== SESSION_CACHE_VERSION || !envelope.data || typeof envelope.data !== 'object') {
    return null;
  }
  const d = envelope.data as SessionData & { expiresAt: string | Date; issuedAt: string | Date };
  if (
    !d.sessionId ||
    !d.userId ||
    !d.organizationId ||
    !d.user?.id ||
    !d.organization?.id ||
    !d.organization?.role ||
    !d.expiresAt ||
    !d.issuedAt
  ) {
    return null;
  }
  const expiresAt = new Date(d.expiresAt);
  const issuedAt = new Date(d.issuedAt);
  if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(issuedAt.getTime())) {
    return null;
  }
  return { ...d, expiresAt, issuedAt };
}

function sessionDataFromProjection(projection: BootstrapSessionProjection): SessionData {
  return {
    sessionId: projection.sessionId,
    userId: projection.userId,
    organizationId: projection.organizationId,
    user: projection.user,
    organization: projection.organization,
    expiresAt: projection.expiresAt,
    issuedAt: projection.createdAt,
  };
}

function cachedSessionMatchesProjection(
  cached: SessionData,
  projection: BootstrapSessionProjection
): boolean {
  return (
    cached.sessionId === projection.sessionId &&
    cached.userId === projection.userId &&
    cached.organizationId === projection.organizationId &&
    cached.expiresAt.getTime() === projection.expiresAt.getTime() &&
    cached.issuedAt.getTime() === projection.createdAt.getTime() &&
    cached.user.id === projection.user.id &&
    cached.user.email === projection.user.email &&
    cached.user.firstName === projection.user.firstName &&
    cached.user.lastName === projection.user.lastName &&
    cached.user.isActive === projection.user.isActive &&
    cached.organization.id === projection.organization.id &&
    cached.organization.name === projection.organization.name &&
    cached.organization.slug === projection.organization.slug &&
    cached.organization.role === projection.organization.role &&
    cached.organization.canManageUsers === projection.organization.canManageUsers &&
    cached.organization.canManageRooms === projection.organization.canManageRooms
  );
}

export async function validateSession(token: string): Promise<SessionData> {
  let cachedSession: SessionData | null = null;

  // Redis remains an accelerator for the complete mapped snapshot, but the
  // constrained resolver is the source of truth for every acceptance.
  try {
    const cached = await getProviders().cache.get(`session:${token}`);
    cachedSession = reviveCachedSession(cached);
    if (cachedSession) {
      const now = new Date();
      const absoluteMax = new Date(
        cachedSession.issuedAt.getTime() + SESSION_CONFIG.ABSOLUTE_MAX_DAYS * 24 * 60 * 60 * 1000
      );
      if (cachedSession.expiresAt <= now || now > absoluteMax || !cachedSession.user.isActive) {
        await getProviders().cache.delete(`session:${token}`);
        cachedSession = null;
      }
    }
  } catch {
    cachedSession = null;
  }

  const projection = await bootstrapRepository.resolveSession(token);
  if (!projection) {
    if (cachedSession) {
      await clearSessionCache([token]);
    }
    throw new AuthenticationError('Invalid session');
  }

  const now = new Date();
  const cacheMatches = cachedSession
    ? cachedSessionMatchesProjection(cachedSession, projection)
    : false;
  const sessionData =
    cachedSession && cacheMatches ? cachedSession : sessionDataFromProjection(projection);

  if (!cacheMatches) {
    if (cachedSession) {
      await clearSessionCache([token]);
    }
    await cacheSessionData(token, sessionData);
  }

  // Sliding-window refresh, throttled: writing lastActiveAt/expiresAt on
  // every request added a DB write per API call for a 24h idle window that
  // only needs minute-level resolution.
  if (now.getTime() - projection.lastActiveAt.getTime() > ACTIVITY_REFRESH_MIN_MS) {
    refreshSessionActivity(token, projection.sessionId).catch(() => {});
  }

  return sessionData;
}

/**
 * Invalidate a session
 */
export async function invalidateSession(token: string): Promise<void> {
  await sessionMutationRepository.invalidateSession(token);
  await clearSessionCache([token]);
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const tokens = await deactivateSessions(db, { userId });
  await clearSessionCache(tokens);
}

export async function deactivateAllUserSessionsInTx(
  tx: SessionMutationClient,
  userId: string
): Promise<string[]> {
  return deactivateSessions(tx, { userId });
}

/**
 * Deactivate only the sessions a user holds in ONE organization.
 *
 * Use for membership-scoped changes (role / active) so that a user who belongs
 * to multiple organizations is not logged out of their OTHER orgs by a change
 * confined to this one. Global identity changes (email / two-factor) must still
 * use deactivateAllUserSessionsInTx, which invalidates everywhere.
 */
export async function deactivateUserOrgSessionsInTx(
  tx: SessionMutationClient,
  userId: string,
  organizationId: string
): Promise<string[]> {
  return deactivateSessions(tx, { userId, organizationId });
}

/**
 * Refresh session activity timestamp (sliding window)
 */
async function refreshSessionActivity(token: string, expectedSessionId: string): Promise<void> {
  const refreshed = await sessionMutationRepository.refreshSession(token);
  if (!refreshed) {
    return;
  }
  if (refreshed.sessionId !== expectedSessionId) {
    await clearSessionCache([token]);
    throw new Error('BOOTSTRAP_SESSION_REFRESH_ID_MISMATCH');
  }

  // The database projection is authoritative. Evict the prior token-keyed
  // accelerator after a successful sliding refresh so the next acceptance
  // caches the new expiry. Cache deletion remains non-fatal and categorical.
  await clearSessionCache([token]);
}

async function deactivateSessions(
  client: SessionMutationClient,
  where: Prisma.SessionWhereInput
): Promise<string[]> {
  const sessions = await client.session.findMany({
    where: {
      ...where,
      isActive: true,
    },
    select: { token: true },
  });

  await client.session.updateMany({
    where,
    data: { isActive: false },
  });

  return sessions.map((session) => session.token);
}

export async function clearSessionCache(tokens: string[]): Promise<void> {
  const cache = getProviders().cache;
  const results = await Promise.allSettled(tokens.map((token) => cache.delete(`session:${token}`)));
  const failureCount = results.filter((result) => result.status === 'rejected').length;
  if (failureCount > 0) {
    console.error(
      JSON.stringify({
        component: 'session-cache',
        event: 'revoked_session_cache_delete',
        outcome: 'partial_failure',
        requestedCount: tokens.length,
        failureCount,
      })
    );
  }
}

/**
 * Cache a complete session snapshot in Redis (short TTL; accelerator only)
 */
async function cacheSessionData(token: string, data: SessionData): Promise<void> {
  const cache = getProviders().cache;
  const envelope: CachedSessionEnvelope = { v: SESSION_CACHE_VERSION, data };
  await cache.set(`session:${token}`, envelope, SESSION_CACHE_TTL_SECONDS);
}
