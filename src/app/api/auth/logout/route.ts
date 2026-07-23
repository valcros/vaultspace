/**
 * Logout API (F004)
 *
 * POST /api/auth/logout - End user session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

import { invalidateSession } from '@/lib/auth';
import { captureAccessAudit } from '@/lib/audit/accessAudit';
import { SESSION_CONFIG } from '@/lib/constants';
import { bootstrapDb } from '@/lib/db';
import { clearSessionCookie } from '@/lib/middleware';

export async function POST(request?: NextRequest) {
  try {
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
        const authSession = await bootstrapDb.session.findUnique({
          where: { token: sessionToken },
          select: {
            id: true,
            userId: true,
            organizationId: true,
            user: { select: { email: true } },
          },
        });
        if (authSession?.organizationId) {
          const membership = await bootstrapDb.userOrganization.findUnique({
            where: {
              organizationId_userId: {
                organizationId: authSession.organizationId,
                userId: authSession.userId,
              },
            },
            select: { role: true },
          });
          auditContext = {
            id: authSession.id,
            userId: authSession.userId,
            organizationId: authSession.organizationId,
            email: authSession.user.email,
            actorType: membership?.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
          };
        }
      } catch {
        // Continue logout without audit context.
      }

      await invalidateSession(sessionToken);
    }

    // Clear session cookie
    await clearSessionCookie();

    if (auditContext) {
      const requestId = request?.headers.get('x-request-id') ?? `req_${randomUUID()}`;
      const ipAddress =
        request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request?.headers.get('x-real-ip') ??
        null;
      await captureAccessAudit({
        organizationId: auditContext.organizationId,
        eventType: 'USER_LOGOUT',
        actorType: auditContext.actorType,
        actorId: auditContext.userId,
        actorEmail: auditContext.email,
        requestId,
        description: 'User signed out',
        metadata: { authSessionId: auditContext.id },
        ipAddress,
        userAgent: request?.headers.get('user-agent') ?? null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LogoutAPI] Error:', error);
    // Still clear cookie even if database operation fails
    await clearSessionCookie();
    return NextResponse.json({ success: true });
  }
}
