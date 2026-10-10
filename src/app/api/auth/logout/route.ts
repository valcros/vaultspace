/**
 * Logout API (F004)
 *
 * POST /api/auth/logout - End user session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

import { invalidateSession } from '@/lib/auth';
import { bootstrapRepository } from '@/lib/auth/bootstrapRepository';
import { stopAccountSwitching, SWITCH_COOKIE_NAME } from '@/lib/auth/accountSwitching';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { SESSION_CONFIG } from '@/lib/constants';
import { clearSessionCookie, getRequestContext } from '@/lib/middleware';
import {
  revokeSysopSessionsForTenantSession,
  SYSOP_COOKIE_NAME,
} from '@/lib/sysop/platformSession';

export async function POST(request?: NextRequest) {
  try {
    const reqContext = request ? getRequestContext(request) : null;
    const requestId = reqContext?.requestId ?? `logout_${randomUUID()}`;
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;
    let auditContext: {
      id: string;
      userId: string;
      organizationId: string;
      email: string;
      actorType: 'ADMIN' | 'VIEWER';
    } | null = null;

    if (sessionToken) {
      // Audit lookup is deliberately non-critical. A lookup failure must not
      // prevent session invalidation or cookie clearing.
      try {
        const authSession = await bootstrapRepository.resolveSession(sessionToken);
        if (authSession) {
          auditContext = {
            id: authSession.sessionId,
            userId: authSession.userId,
            organizationId: authSession.organizationId,
            email: authSession.user.email,
            actorType: authSession.organization.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
          };
          try {
            await revokeSysopSessionsForTenantSession(
              { userId: authSession.userId, sessionId: authSession.sessionId },
              requestId
            );
          } catch {
            // The tenant session invalidation below still makes any bound
            // platform session unusable. Do not let an audit outage trap logout.
          }
          try {
            await stopAccountSwitching(
              { userId: authSession.userId, sessionId: authSession.sessionId },
              requestId
            );
          } catch {
            // Invalidating the tenant session also invalidates its switch proof.
          }
        }
      } catch {
        // Continue logout without audit context.
      }

      await invalidateSession(sessionToken);
    }

    // Clear session cookie
    await clearSessionCookie();
    cookieStore.delete?.(SYSOP_COOKIE_NAME);
    cookieStore.delete?.(SWITCH_COOKIE_NAME);

    if (auditContext) {
      await captureAccessAudit({
        organizationId: auditContext.organizationId,
        eventType: 'USER_LOGOUT',
        actorType: auditContext.actorType,
        actorId: auditContext.userId,
        actorEmail: auditContext.email,
        requestId,
        description: 'User signed out',
        metadata: { authSessionId: auditContext.id },
        ipAddress: reqContext && reqContext.ipAddress !== 'unknown' ? reqContext.ipAddress : null,
        userAgent: reqContext && reqContext.userAgent !== 'unknown' ? reqContext.userAgent : null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LogoutAPI] Error:', error);
    // Still clear cookie even if database operation fails
    await clearSessionCookie();
    (await cookies()).delete?.(SYSOP_COOKIE_NAME);
    (await cookies()).delete?.(SWITCH_COOKIE_NAME);
    return NextResponse.json({ success: true });
  }
}
