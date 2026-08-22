/**
 * Current-member in-app notification inbox.
 *
 * This is intentionally separate from /api/users/me/notifications, which
 * manages delivery preferences. Every query is derived from the authenticated
 * session and the active membership, never from an organization or member id
 * supplied by the client.
 */

import { NextRequest, NextResponse } from 'next/server';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 20;

export async function GET() {
  try {
    const session = await requireAuth();
    const result = await withOrgContext(session.organizationId, async (tx) => {
      const membership = await tx.userOrganization.findFirst({
        where: {
          userId: session.userId,
          organizationId: session.organizationId,
          isActive: true,
          archivedAt: null,
          user: { isActive: true },
        },
        select: { id: true },
      });
      if (!membership) {
        return { error: 'Active organization membership required', status: 403 } as const;
      }

      const [items, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where: {
            organizationId: session.organizationId,
            userOrganizationId: membership.id,
          },
          select: {
            id: true,
            type: true,
            title: true,
            message: true,
            isRead: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ITEMS,
        }),
        tx.notification.count({
          where: {
            organizationId: session.organizationId,
            userOrganizationId: membership.id,
            isRead: false,
          },
        }),
      ]);
      return {
        items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
        unreadCount,
      };
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[NotificationInboxAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => null);
    const markAll = body?.all === true;
    const notificationId = typeof body?.notificationId === 'string' ? body.notificationId : null;
    if (!markAll && (!notificationId || notificationId.length > 128)) {
      return NextResponse.json({ error: 'notificationId or all is required' }, { status: 400 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const membership = await tx.userOrganization.findFirst({
        where: {
          userId: session.userId,
          organizationId: session.organizationId,
          isActive: true,
          archivedAt: null,
          user: { isActive: true },
        },
        select: { id: true },
      });
      if (!membership) {
        return { error: 'Active organization membership required', status: 403 } as const;
      }

      const update = await tx.notification.updateMany({
        where: {
          organizationId: session.organizationId,
          userOrganizationId: membership.id,
          isRead: false,
          ...(markAll ? {} : { id: notificationId! }),
        },
        data: { isRead: true },
      });
      const unreadCount = await tx.notification.count({
        where: {
          organizationId: session.organizationId,
          userOrganizationId: membership.id,
          isRead: false,
        },
      });
      return { updated: update.count, unreadCount };
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[NotificationInboxAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}
