/**
 * Messages Inbox API
 *
 * GET /api/messages/inbox - Get messages received by the current user
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messages/inbox
 * List messages received by the current user, ordered by newest first.
 * Includes sender info, room name, and document name.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const messages = await withOrgContext(session.organizationId, async (tx) => {
      return tx.message.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [{ recipientUserId: session.userId }, { recipientEmail: session.user.email }],
        },
        include: {
          sender: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          room: {
            select: {
              id: true,
              name: true,
            },
          },
          document: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
    });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        subject: m.subject,
        body: m.body,
        sender: {
          id: m.sender.id,
          email: m.sender.email,
          name: `${m.sender.firstName} ${m.sender.lastName}`.trim(),
        },
        room: m.room ? { id: m.room.id, name: m.room.name } : null,
        document: m.document ? { id: m.document.id, name: m.document.name } : null,
        isRead: m.isRead,
        readAt: m.readAt?.toISOString() || null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[MessagesAPI] Inbox GET error:', error);
    return NextResponse.json({ error: 'Failed to list inbox messages' }, { status: 500 });
  }
}
