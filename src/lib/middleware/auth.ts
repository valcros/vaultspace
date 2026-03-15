/**
 * Authentication Middleware
 *
 * Validates session tokens and extracts user context.
 */

import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { validateSession } from '../auth';
import { SESSION_CONFIG } from '../constants';
import { AuthenticationError } from '../errors';

import type { SessionData } from '../auth';

export interface RequestContext {
  session: SessionData;
  requestId: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Get session from cookies (for server components/API routes)
 */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    return await validateSession(token);
  } catch {
    return null;
  }
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();

  if (!session) {
    throw new AuthenticationError('Authentication required');
  }

  return session;
}

/**
 * Require admin role
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();

  if (session.organization.role !== 'ADMIN') {
    throw new AuthenticationError('Admin access required', 'FORBIDDEN');
  }

  return session;
}

/**
 * Extract request context from NextRequest
 */
export function getRequestContext(request: NextRequest): {
  requestId: string;
  ipAddress: string;
  userAgent: string;
} {
  const requestId =
    request.headers.get('x-request-id') ??
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  return { requestId, ipAddress, userAgent };
}

/**
 * Set session cookie
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_CONFIG.COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Clear session cookie
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_CONFIG.COOKIE_NAME);
}
