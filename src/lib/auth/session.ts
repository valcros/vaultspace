/**
 * Session Management
 *
 * PostgreSQL-backed sessions with Redis caching for performance.
 * Session tokens are the sole source of truth for authentication.
 */

import type { Prisma, Session } from '@prisma/client';

import { SESSION_CONFIG } from '../constants';
import { bootstrapDb, db, withOrgContext } from '../db';
import { AuthenticationError } from '../errors';
import { getProviders } from '@/providers';

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

type SessionMutationClient = Pick<Prisma.TransactionClient, 'session'>;

/**
 * Create a new session for a user
 */
export async function createSession(
  userId: string,
  organizationId: string,
  metadata?: { ipAddress?: string; userAgent?: string }
): Promise<{ session: Session; token: string }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60 * 1000);

  const session = await db.session.create({
    data: {
      userId,
      organizationId,
      token,
      expiresAt,
      lastActiveAt: now,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
    },
  });

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

export async function validateSession(token: string): Promise<SessionData> {
  // Fast path: recent full validation cached in Redis.
  try {
    const cached = await getProviders().cache.get(`session:${token}`);
    const revived = reviveCachedSession(cached);
    if (revived) {
      const now = new Date();
      const absoluteMax = new Date(
        revived.issuedAt.getTime() + SESSION_CONFIG.ABSOLUTE_MAX_DAYS * 24 * 60 * 60 * 1000
      );
      if (revived.expiresAt > now && now <= absoluteMax && revived.user.isActive) {
        return revived;
      }
      // Expired or inactive in cache: fall through to the DB path, which owns
      // deactivation and error semantics.
    }
  } catch {
    // Cache unavailable or malformed — full DB validation below.
  }

  // Fetch from database. Uses bootstrapDb because:
  //   1. The session token is the only thing we have at this point — we don't
  //      yet know the user's org, so we can't establish RLS context.
  //   2. The `include: { user: true }` JOIN reads from the RLS-protected users
  //      table, which on the regular pool can fail when a previous request
  //      left non-NULL `app.current_org_id` on the connection.
  // Sessions table itself has no RLS; the admin connection bypasses RLS for
  // the user JOIN and any session.update calls in this function.
  const session = await bootstrapDb.session.findUnique({
    where: { token },
    include: {
      user: true,
    },
  });

  if (!session || !session.isActive) {
    throw new AuthenticationError('Invalid session');
  }

  // Check expiration
  const now = new Date();
  if (session.expiresAt < now) {
    // Session expired - deactivate and throw
    await bootstrapDb.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    throw new AuthenticationError('Session expired', 'SESSION_EXPIRED');
  }

  // Check absolute max (7 days)
  const absoluteMax = new Date(
    session.createdAt.getTime() + SESSION_CONFIG.ABSOLUTE_MAX_DAYS * 24 * 60 * 60 * 1000
  );
  if (now > absoluteMax) {
    await bootstrapDb.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    throw new AuthenticationError('Session expired', 'SESSION_EXPIRED');
  }

  // Check if user is still active
  if (!session.user.isActive) {
    await bootstrapDb.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    throw new AuthenticationError('Account disabled', 'ACCOUNT_DISABLED');
  }

  // Get organization membership
  const orgId = session.organizationId;
  if (!orgId) {
    throw new AuthenticationError('No organization bound to session');
  }

  // Use RLS context for org-scoped membership lookup
  const membership = await withOrgContext(orgId, async (tx) => {
    return tx.userOrganization.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: session.userId,
        },
      },
      include: {
        organization: true,
      },
    });
  });

  if (!membership || !membership.isActive) {
    throw new AuthenticationError('Organization access revoked');
  }

  const sessionData: SessionData = {
    sessionId: session.id,
    userId: session.userId,
    organizationId: orgId,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      isActive: session.user.isActive,
    },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
      canManageUsers: membership.canManageUsers,
      canManageRooms: membership.canManageRooms,
    },
    expiresAt: session.expiresAt,
    issuedAt: session.createdAt,
  };

  // Cache the complete snapshot (short TTL; see contract above)
  await cacheSessionData(token, sessionData);

  // Sliding-window refresh, throttled: writing lastActiveAt/expiresAt on
  // every request added a DB write per API call for a 24h idle window that
  // only needs minute-level resolution.
  if (now.getTime() - session.lastActiveAt.getTime() > ACTIVITY_REFRESH_MIN_MS) {
    refreshSessionActivity(session.id).catch(() => {});
  }

  return sessionData;
}

/**
 * Invalidate a session
 */
export async function invalidateSession(token: string): Promise<void> {
  const tokens = await deactivateSessions(db, { token });
  await clearSessionCache(tokens);
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
 * Refresh session activity timestamp (sliding window)
 */
async function refreshSessionActivity(sessionId: string): Promise<void> {
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60 * 1000);

  // Sessions table has no RLS, but using bootstrapDb for consistency with the
  // rest of session lifecycle and to avoid any pool-state surprises.
  await bootstrapDb.session.update({
    where: { id: sessionId },
    data: {
      lastActiveAt: now,
      expiresAt: newExpiresAt,
    },
  });
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
  await Promise.allSettled(tokens.map((token) => cache.delete(`session:${token}`)));
}

/**
 * Cache a complete session snapshot in Redis (short TTL; accelerator only)
 */
async function cacheSessionData(token: string, data: SessionData): Promise<void> {
  const cache = getProviders().cache;
  const envelope: CachedSessionEnvelope = { v: SESSION_CACHE_VERSION, data };
  await cache.set(`session:${token}`, envelope, SESSION_CACHE_TTL_SECONDS);
}
