/**
 * Resend Invitation API
 *
 * POST /api/rooms/:roomId/links/:linkId/resend
 *
 * Re-sends the invitation email for an existing viewer-invite link. Used to
 * deliver the initial email for invites created before automated sending
 * existed (e.g. legacy pending invites), and to manually nudge a recipient.
 *
 * Sending stamps `inviteEmailSentAt = now` and resets `remindersSent = 0`,
 * which restarts the automated reminder cadence (48h / 1 week) from this send.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { buildInviteEmail } from '@/lib/email/inviteEmail';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; linkId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, linkId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const loaded = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
        select: { id: true, name: true },
      });
      if (!room) {
        return { error: 'Room not found', status: 404 } as const;
      }

      const link = await tx.link.findFirst({
        where: { id: linkId, roomId, organizationId: session.organizationId },
        select: {
          id: true,
          slug: true,
          allowedEmails: true,
          inviteeName: true,
          inviteMessage: true,
          expiresAt: true,
          isActive: true,
        },
      });
      if (!link) {
        return { error: 'Link not found', status: 404 } as const;
      }
      if (!link.isActive) {
        return { error: 'Cannot resend an inactive invitation', status: 409 } as const;
      }
      const recipient = link.allowedEmails[0];
      if (!recipient) {
        return { error: 'This link has no invited email to resend to', status: 400 } as const;
      }

      return { room, link, recipient };
    });

    if ('error' in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    const { room, link, recipient } = loaded;
    const inviterName =
      `${session.user.firstName ?? ''} ${session.user.lastName ?? ''}`.trim() || session.user.email;
    const baseUrl = new URL(request.url).origin;
    const sentAt = new Date();

    const { subject, html } = buildInviteEmail({
      roomName: room.name,
      inviterName,
      inviteeName: link.inviteeName,
      message: link.inviteMessage,
      link: `${baseUrl}/view/${link.slug}`,
      expiresAt: link.expiresAt,
    });

    try {
      await getProviders().email.sendEmail({ to: recipient, subject, html });
    } catch (err) {
      console.error(`[ResendInvite] Failed to send to ${recipient}:`, err);
      return NextResponse.json({ error: 'Failed to send invitation email' }, { status: 502 });
    }

    // Restart the reminder cadence from this send.
    await withOrgContext(session.organizationId, async (tx) => {
      await tx.link.update({
        where: { id: link.id },
        data: { inviteEmailSentAt: sentAt, remindersSent: 0, lastReminderAt: null },
      });
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'LINK_CREATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Resent invitation to ${recipient}`,
          metadata: { linkId: link.id },
        },
      });
    });

    return NextResponse.json({ resent: true, email: recipient });
  } catch (error) {
    console.error('[ResendInvite] POST error:', error);
    return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 });
  }
}
