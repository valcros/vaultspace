/**
 * Session Management
 *
 * PostgreSQL-backed sessions with Redis caching for performance.
 * Session tokens are the sole source of truth for authentication.
 */

import type { Session } from '@prisma/client';

import { SESSION_CONFIG } from '../constants';
import { db } from '../db';
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
  // Try cache first
  const cached = await getCachedSession(token);
  if (cached) {
    // Refresh session activity in background
    refreshSessionActivity(cached.sessionId).catch(() => {});
    return cached;
  }

  // Fetch from database
  const session = await db.session.findUnique({
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
    await db.session.update({
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
    await db.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    throw new AuthenticationError('Session expired', 'SESSION_EXPIRED');
  }

  // Check if user is still active
  if (!session.user.isActive) {
    await db.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    throw new AuthenticationError('Account disabled', 'ACCOUNT_DISABLED');
  }

  // Get organization membership
  if (!session.organizationId) {
    throw new AuthenticationError('No organization bound to session');
  }

  const membership = await db.userOrganization.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.organizationId,
        userId: session.userId,
      },
    },
    include: {
      organization: true,
    },
  });

  if (!membership || !membership.isActive) {
    throw new AuthenticationError('Organization access revoked');
  }

  const sessionData: SessionData = {
    sessionId: session.id,
    userId: session.userId,
    organizationId: session.organizationId,
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
  await db.session.updateMany({
    where: { token },
    data: { isActive: false },
  });

  // Remove from cache
  const cache = getProviders().cache;
  await cache.delete(`session:${token}`);
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const sessions = await db.session.findMany({
    where: { userId, isActive: true },
    select: { token: true },
  });

  await db.session.updateMany({
    where: { userId },
    data: { isActive: false },
  });

  // Remove all from cache
  const cache = getProviders().cache;
  await Promise.all(sessions.map((s) => cache.delete(`session:${s.token}`)));
}

/**
 * Refresh session activity timestamp (sliding window)
 */
async function refreshSessionActivity(sessionId: string): Promise<void> {
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60 * 1000);

  await db.session.update({
    where: { id: sessionId },
    data: {
      lastActiveAt: now,
      expiresAt: newExpiresAt,
    },
  });
}

/**
 * Cache session data in Redis
 */
async function cacheSessionData(token: string, data: Partial<SessionData>): Promise<void> {
  const cache = getProviders().cache;
  const ttl = SESSION_CONFIG.IDLE_TIMEOUT_HOURS * 60 * 60;
  await cache.set(`session:${token}`, data, ttl);
}

/**
 * Get cached session data
 */
async function getCachedSession(token: string): Promise<SessionData | null> {
  const cache = getProviders().cache;
  return cache.get<SessionData>(`session:${token}`);
}
