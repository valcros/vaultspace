/**
 * Single Message API
 *
 * GET    /api/messages/[messageId] - Get message detail
 * PATCH  /api/messages/[messageId] - Mark as read (recipient only)
 * DELETE /api/messages/[messageId] - Delete message (sender/admin only)
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ messageId: string }> };

/**
 * GET /api/messages/[messageId]
 * Get a single message with sender/recipient info
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuthFromRequest(request);
    const { messageId } = await context.params;

    const message = await withOrgContext(session.organizationId, async (tx) => {
      return tx.message.findFirst({
        where: {
          id: messageId,
          organizationId: session.organizationId,
          OR: [
            { senderUserId: session.userId },
            { recipientUserId: session.userId },
            { recipientEmail: session.user.email },
          ],
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
          recipient: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          room: {
            select: { id: true, name: true },
          },
          document: {
            select: { id: true, name: true },
          },
        },
      });
    });

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: {
        id: message.id,
        subject: message.subject,
        body: message.body,
        recipientEmail: message.recipientEmail,
        sender: {
          id: message.sender.id,
          email: message.sender.email,
          name: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
        },
        recipient: message.recipient
          ? {
              id: message.recipient.id,
              email: message.recipient.email,
              name: `${message.recipient.firstName} ${message.recipient.lastName}`.trim(),
            }
          : null,
        room: message.room ? { id: message.room.id, name: message.room.name } : null,
        document: message.document
          ? { id: message.document.id, name: message.document.name }
          : null,
        isRead: message.isRead,
        readAt: message.readAt?.toISOString() || null,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[MessagesAPI] GET [messageId] error:', error);
    return NextResponse.json({ error: 'Failed to get message' }, { status: 500 });
  }
}

/**
 * PATCH /api/messages/[messageId]
 * Mark message as read. Only the recipient can mark as read.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuthFromRequest(request);
    const { messageId } = await context.params;

    const updated = await withOrgContext(session.organizationId, async (tx) => {
      // Find message where the current user is the recipient
      const message = await tx.message.findFirst({
        where: {
          id: messageId,
          organizationId: session.organizationId,
          OR: [{ recipientUserId: session.userId }, { recipientEmail: session.user.email }],
        },
        select: { id: true },
      });

      if (!message) {
        return null;
      }

      return tx.message.update({
        where: { id: messageId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
        select: {
          id: true,
          isRead: true,
          readAt: true,
        },
      });
    });

    if (!updated) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: {
        id: updated.id,
        isRead: updated.isRead,
        readAt: updated.readAt?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error('[MessagesAPI] PATCH [messageId] error:', error);
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }
}

/**
 * DELETE /api/messages/[messageId]
 * Delete a sent message. Only the sender (admin) can delete.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuthFromRequest(request);
    const { messageId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const deleted = await withOrgContext(session.organizationId, async (tx) => {
      const message = await tx.message.findFirst({
        where: {
          id: messageId,
          organizationId: session.organizationId,
          senderUserId: session.userId,
        },
        select: { id: true },
      });

      if (!message) {
        return null;
      }

      await tx.message.delete({ where: { id: messageId } });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MessagesAPI] DELETE [messageId] error:', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
