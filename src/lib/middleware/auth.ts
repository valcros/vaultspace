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
import { db } from '../db';

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
 * Get session from NextRequest (alternative for API routes)
 * Tries multiple methods to read the cookie for maximum compatibility
 */
export async function getSessionFromRequest(request: NextRequest): Promise<SessionData | null> {
  let token: string | undefined;

  // Method 1: Try cookies() from next/headers first (works for SSR and API routes)
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;
  } catch {
    // cookies() may fail in some contexts, try alternatives
  }

  // Method 2: Try request.cookies
  if (!token) {
    token = request.cookies.get(SESSION_CONFIG.COOKIE_NAME)?.value;
  }

  // Method 3: Parse Cookie header directly as fallback
  if (!token) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const parsedCookies = Object.fromEntries(
        cookieHeader.split('; ').map((c) => {
          const [key, ...val] = c.split('=');
          return [key, val.join('=')];
        })
      );
      token = parsedCookies[SESSION_CONFIG.COOKIE_NAME];
    }
  }

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
 * Require authentication from request - throws if not authenticated
 */
export async function requireAuthFromRequest(request: NextRequest): Promise<SessionData> {
  const session = await getSessionFromRequest(request);

  if (!session) {
    throw new AuthenticationError('Authentication required');
  }

  return session;
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
 * Custom domain context from middleware headers
 */
export interface CustomDomainContext {
  customHost: string | null;
  orgSlug: string | null;
}

/**
 * Extract request context from NextRequest
 */
export function getRequestContext(request: NextRequest): {
  requestId: string;
  ipAddress: string;
  userAgent: string;
  customDomain: CustomDomainContext;
} {
  const requestId =
    request.headers.get('x-request-id') ??
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  // Extract custom domain headers set by middleware
  const customDomain: CustomDomainContext = {
    customHost: request.headers.get('x-custom-host'),
    orgSlug: request.headers.get('x-org-slug'),
  };

  return { requestId, ipAddress, userAgent, customDomain };
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

/**
 * Resolve organization from custom domain headers (F001)
 * Used by routes that need to handle custom domain/subdomain scenarios
 *
 * PRE-RLS BOOTSTRAP: This function intentionally uses the global db client
 * without org context, as we're resolving which organization based on domain/slug
 * BEFORE the org context can be established. The RLS policy `org_bootstrap_lookup`
 * allows SELECT on organizations when no org context is set.
 *
 * Security: Only minimal public fields (id, slug) are selected. Active check is enforced.
 */
export async function resolveOrganizationFromHeaders(
  customDomain: CustomDomainContext
): Promise<{ organizationId: string; organizationSlug: string } | null> {
  // PRE-RLS BOOTSTRAP: Lookup org by slug (no org context yet)
  if (customDomain.orgSlug) {
    const org = await db.organization.findFirst({
      where: {
        slug: customDomain.orgSlug,
        isActive: true,
      },
      select: { id: true, slug: true },
    });
    if (org) {
      return { organizationId: org.id, organizationSlug: org.slug };
    }
  }

  // PRE-RLS BOOTSTRAP: Lookup org by custom domain (no org context yet)
  if (customDomain.customHost) {
    const org = await db.organization.findFirst({
      where: {
        customDomain: customDomain.customHost,
        isActive: true,
      },
      select: { id: true, slug: true },
    });
    if (org) {
      return { organizationId: org.id, organizationSlug: org.slug };
    }
  }

  return null;
}
