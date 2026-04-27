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

  // Cache session data in Redis
  await cacheSessionData(token, {
    sessionId: session.id,
    userId,
    organizationId,
    expiresAt,
  });

  return { session, token };
}

/**
 * Validate and refresh a session token
 * Returns session data if valid, throws otherwise
 */
export async function validateSession(token: string): Promise<SessionData> {
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

  // Cache the session data
  await cacheSessionData(token, sessionData);

  // Refresh session in background
  refreshSessionActivity(session.id).catch(() => {});

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
 * Cache session data in Redis
 */
async function cacheSessionData(token: string, data: Partial<SessionData>): Promise<void> {
  const cache = getProviders().cache;
  const ttl = SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60;
  await cache.set(`session:${token}`, data, ttl);
}
