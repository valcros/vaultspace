/**
 * Authentication Middleware
 *
 * Validates session tokens and extracts user context.
 */

import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

import { validateSession } from '../auth';
import {
  bootstrapRepository,
  type BootstrapOrganizationProjection,
} from '../auth/bootstrapRepository';
import { SESSION_CONFIG } from '../constants';
import { db } from '../db';
import { AuthenticationError, AuthorizationError } from '../errors';

import type { SessionData } from '../auth';

export interface RequestContext {
  session: SessionData;
  requestId: string;
  ipAddress: string;
  userAgent: string;
}

export interface AuthenticatedSessionCredential {
  session: SessionData;
  token: string;
}

async function getSessionCredential(): Promise<AuthenticatedSessionCredential | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    return { session: await validateSession(token), token };
  } catch {
    return null;
  }
}

/**
 * Get session from cookies (for server components/API routes)
 */
export async function getSession(): Promise<SessionData | null> {
  return (await getSessionCredential())?.session ?? null;
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
  return (await requireAuthCredential()).session;
}

/**
 * Require authentication and retain the exact server-side bearer proof for a
 * credential-bound database operation. The token is never added to SessionData.
 */
export async function requireAuthCredential(): Promise<AuthenticatedSessionCredential> {
  const credential = await getSessionCredential();

  if (!credential) {
    throw new AuthenticationError('Authentication required');
  }

  return credential;
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
 * Require platform-operator access for the cross-tenant SysOp control plane.
 *
 * This is a platform-level grant (`User.isPlatformOperator`), deliberately
 * independent of any org role — an org ADMIN/OWNER is NOT an operator. Every
 * `/sysop` page and `/api/sysop/*` route MUST call this before reading or
 * mutating cross-tenant data.
 *
 * Throws AuthenticationError (401) if not signed in, AuthorizationError (403)
 * if signed in without an active operator grant.
 */
import { SysopIpAllowlistService } from '@/lib/sysop/ipAllowlist';
import { getClientIp } from '@/lib/utils/ip';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';
import { headers } from 'next/headers';

export async function requirePlatformOperator(): Promise<SessionData> {
  const session = await requireAuth();

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, isPlatformOperator: true },
  });

  if (!user?.isActive || !user.isPlatformOperator) {
    throw new AuthorizationError('Platform operator access required');
  }

  // SysOp In-App IP Allowlist Enforcement
  try {
    const headersList = await headers();
    const clientIp = getClientIp(headersList);
    const ipCheck = await SysopIpAllowlistService.isClientIpAllowed(clientIp);

    if (!ipCheck.allowed) {
      await captureSecurityAudit({
        organizationId: session.organizationId,
        eventType: 'SYSOP_IP_BLOCKED',
        actorType: 'ADMIN',
        actorId: session.userId,
        requestId: `sysop_ip_blocked_${Date.now()}`,
        description: `SysOp request blocked from unauthorized IP address ${clientIp ?? 'unknown'}`,
        metadata: { clientIp, reason: ipCheck.reason },
      });

      throw new AuthorizationError(
        `Access denied: IP address ${clientIp ?? 'unknown'} is not authorized for SysOp control plane`
      );
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw error;
    }
    // Fail open if headers context is unavailable in test harnesses
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
  const suppliedRequestId = request.headers.get('x-request-id');
  const requestId =
    suppliedRequestId && /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : `req_${randomUUID()}`;

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  // Resolve org context from the request. Prefer middleware-set headers, but
  // fall back to parsing the Host header directly so resolution does not depend
  // on middleware forwarding (which is not applied uniformly to API routes).
  const hostHeader = request.headers.get('host') ?? '';
  let derivedSlug: string | null = null;
  const mainDomains = (
    process.env['MAIN_DOMAINS'] || 'vaultspace.org,vaultspace.app,vaultspace.local'
  ).split(',');
  for (const domain of mainDomains) {
    if (hostHeader.endsWith('.' + domain)) {
      const sub = hostHeader.replace('.' + domain, '').split(':')[0];
      if (sub && sub !== 'www') {
        derivedSlug = sub;
      }
      break;
    }
  }

  const customDomain: CustomDomainContext = {
    customHost: request.headers.get('x-custom-host') ?? (hostHeader || null),
    orgSlug: request.headers.get('x-org-slug') ?? derivedSlug,
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
 * PRE-RLS BOOTSTRAP: resolves which organization a request belongs to from the
 * domain/slug BEFORE any org context exists. The ordinary runtime pool calls
 * one reviewed SECURITY DEFINER function through BootstrapRepository.
 *
 * Security: only the accepted public organization projection is returned. The
 * function enforces active state and has no administrative fallback.
 */
export async function resolveOrganizationFromHeaders(
  customDomain: CustomDomainContext
): Promise<BootstrapOrganizationProjection | null> {
  if (customDomain.orgSlug) {
    const org = await bootstrapRepository.resolveOrganizationBySlug(customDomain.orgSlug);
    if (org) {
      return org;
    }
  }

  if (customDomain.customHost) {
    const org = await bootstrapRepository.resolveOrganizationByCustomDomain(
      customDomain.customHost
    );
    if (org) {
      return org;
    }
  }

  return null;
}
