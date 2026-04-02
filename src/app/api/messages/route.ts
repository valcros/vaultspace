/**
 * Messages Collection API
 *
 * GET  /api/messages - List sent messages (admin only)
 * POST /api/messages - Send a message (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messages
 * List messages sent by the admin. Supports filtering by roomId, recipientEmail.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    const recipientEmail = searchParams.get('recipientEmail');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const messages = await withOrgContext(session.organizationId, async (tx) => {
      return tx.message.findMany({
        where: {
          organizationId: session.organizationId,
          senderUserId: session.userId,
          ...(roomId ? { roomId } : {}),
          ...(recipientEmail ? { recipientEmail } : {}),
        },
        include: {
          recipient: {
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
        recipientEmail: m.recipientEmail,
        recipient: m.recipient
          ? {
              id: m.recipient.id,
              email: m.recipient.email,
              name: `${m.recipient.firstName} ${m.recipient.lastName}`.trim(),
            }
          : null,
        room: m.room ? { id: m.room.id, name: m.room.name } : null,
        document: m.document ? { id: m.document.id, name: m.document.name } : null,
        isRead: m.isRead,
        readAt: m.readAt?.toISOString() || null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[MessagesAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list messages' }, { status: 500 });
  }
}

/**
 * POST /api/messages
 * Send a new message. Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { recipientEmail, subject, body: messageBody, roomId, documentId } = body;

    // Validate required fields
    if (!recipientEmail || typeof recipientEmail !== 'string') {
      return NextResponse.json({ error: 'recipientEmail is required' }, { status: 400 });
    }
    if (!subject || typeof subject !== 'string') {
      return NextResponse.json({ error: 'subject is required' }, { status: 400 });
    }
    if (!messageBody || typeof messageBody !== 'string') {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    if (subject.length > 500) {
      return NextResponse.json(
        { error: 'subject must be 500 characters or less' },
        { status: 400 }
      );
    }

    const message = await withOrgContext(session.organizationId, async (tx) => {
      // Optionally resolve recipient user by email
      const recipientUser = await tx.user.findFirst({
        where: { email: recipientEmail.toLowerCase() },
        select: { id: true },
      });

      // Validate roomId belongs to org if provided
      if (roomId) {
        const room = await tx.room.findFirst({
          where: { id: roomId, organizationId: session.organizationId },
          select: { id: true },
        });
        if (!room) {
          throw new Error('ROOM_NOT_FOUND');
        }
      }

      // Validate documentId belongs to org if provided
      if (documentId) {
        const doc = await tx.document.findFirst({
          where: { id: documentId, organizationId: session.organizationId },
          select: { id: true },
        });
        if (!doc) {
          throw new Error('DOCUMENT_NOT_FOUND');
        }
      }

      return tx.message.create({
        data: {
          organizationId: session.organizationId,
          senderUserId: session.userId,
          recipientEmail: recipientEmail.toLowerCase(),
          recipientUserId: recipientUser?.id || null,
          subject: subject.trim(),
          body: messageBody.trim(),
          roomId: roomId || null,
          documentId: documentId || null,
        },
        include: {
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

    return NextResponse.json(
      {
        message: {
          id: message.id,
          subject: message.subject,
          body: message.body,
          recipientEmail: message.recipientEmail,
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
          createdAt: message.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'ROOM_NOT_FOUND') {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 });
      }
      if (error.message === 'DOCUMENT_NOT_FOUND') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
    }
    console.error('[MessagesAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
