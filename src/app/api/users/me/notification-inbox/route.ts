import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { isAuthenticationError, RateLimitError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { rateLimiters } from '@/lib/middleware/rateLimit';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

async function activeMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string
) {
  return tx.userOrganization.findFirst({
    where: {
      userId,
      organizationId,
      isActive: true,
      archivedAt: null,
      user: { isActive: true },
    },
    select: { id: true },
  });
}

function safeActionPath(path: string | null): string | null {
  return path && /^\/rooms\/[a-zA-Z0-9_-]+(?:\?manage=(?:qa|members))?$/.test(path) ? path : null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await rateLimiters.viewerRequests(session.userId);
    const cursorId = request.nextUrl.searchParams.get('cursor');
    if (cursorId && (cursorId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(cursorId))) {
      return NextResponse.json({ error: 'Invalid notification cursor' }, { status: 400 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const membership = await activeMembership(tx, session.userId, session.organizationId);
      if (!membership) {
        return { error: 'Active organization membership required', status: 403 } as const;
      }

      const cursor = cursorId
        ? await tx.notification.findFirst({
            where: {
              id: cursorId,
              organizationId: session.organizationId,
              userOrganizationId: membership.id,
            },
            select: { id: true, createdAt: true },
          })
        : null;
      if (cursorId && !cursor) {
        return { error: 'Invalid notification cursor', status: 400 } as const;
      }

      const where = {
        organizationId: session.organizationId,
        userOrganizationId: membership.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      };
      const [rows, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where,
          select: {
            id: true,
            type: true,
            title: true,
            message: true,
            actionPath: true,
            isRead: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: PAGE_SIZE + 1,
        }),
        tx.notification.count({
          where: {
            organizationId: session.organizationId,
            userOrganizationId: membership.id,
            isRead: false,
          },
        }),
      ]);
      const hasMore = rows.length > PAGE_SIZE;
      const page = rows.slice(0, PAGE_SIZE);
      return {
        items: page.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          message: item.message,
          actionPath: safeActionPath(item.actionPath),
          isRead: item.isRead,
          createdAt: item.createdAt.toISOString(),
        })),
        unreadCount,
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many notification requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(error.retryAfter) },
        }
      );
    }
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[NotificationInbox] GET error:', error);
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    await rateLimiters.viewerRequests(session.userId);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const markAll = input['all'] === true;
    const notificationId =
      typeof input['notificationId'] === 'string' ? input['notificationId'] : null;
    if (
      (!markAll && !notificationId) ||
      (notificationId && !/^[a-zA-Z0-9_-]{1,128}$/.test(notificationId))
    ) {
      return NextResponse.json(
        { error: 'A valid notificationId or all is required' },
        { status: 400 }
      );
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const membership = await activeMembership(tx, session.userId, session.organizationId);
      if (!membership) {
        return { error: 'Active organization membership required', status: 403 } as const;
      }
      const updated = await tx.notification.updateMany({
        where: {
          organizationId: session.organizationId,
          userOrganizationId: membership.id,
          isRead: false,
          ...(!markAll ? { id: notificationId! } : {}),
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
      return { updated: updated.count, unreadCount };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many notification requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(error.retryAfter) },
        }
      );
    }
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[NotificationInbox] PATCH error:', error);
    return NextResponse.json({ error: 'Could not update notifications' }, { status: 500 });
  }
}
