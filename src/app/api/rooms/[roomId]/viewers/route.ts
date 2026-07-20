/**
 * Bulk Viewer Management API (F045)
 *
 * GET    /api/rooms/:roomId/viewers - List all viewers who accessed the room
 * POST   /api/rooms/:roomId/viewers - Bulk invite viewers
 * DELETE /api/rooms/:roomId/viewers - Bulk revoke viewer access
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { buildInviteEmail } from '@/lib/email/inviteEmail';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const bulkInviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(100),
  linkId: z.string().optional(),
  // Optional invitation context, stored on newly created per-invitee links.
  inviteeName: z.string().trim().max(255).optional(),
  inviteeCompany: z.string().trim().max(255).optional(),
  message: z.string().trim().max(2000).optional(),
  // Auto-expiry window (days). Defaults to 14 for the invitation flow.
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const bulkRevokeSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(100),
});

/**
 * GET /api/rooms/:roomId/viewers
 * List all viewers who have accessed the room via share links.
 * Grouped by visitorEmail, showing: email, name, total visits, last active, total time spent, link used.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: { id: true },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get all view sessions for this room with visitor emails
      const sessions = await tx.viewSession.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          visitorEmail: { not: null },
        },
        orderBy: { lastActivityAt: 'desc' },
        // Guardrail cap (audit finding 22): the JS dedupe below is O(sessions);
        // 2000 recent sessions cover the roster views this feeds.
        take: 2000,
        select: {
          visitorEmail: true,
          visitorName: true,
          totalTimeSpentSeconds: true,
          lastActivityAt: true,
          linkId: true,
          isActive: true,
          link: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      // Deduplicate by email
      const viewerMap = new Map<
        string,
        {
          email: string;
          name: string | null;
          visits: number;
          lastActive: Date;
          totalTimeSpent: number;
          linkName: string | null;
          linkId: string | null;
          isActive: boolean;
        }
      >();

      for (const s of sessions) {
        if (!s.visitorEmail) {
          continue;
        }
        const emailKey = s.visitorEmail.toLowerCase();
        const existing = viewerMap.get(emailKey);

        if (existing) {
          existing.visits += 1;
          existing.totalTimeSpent += s.totalTimeSpentSeconds;
          if (s.lastActivityAt > existing.lastActive) {
            existing.lastActive = s.lastActivityAt;
            // Update name if newer session has one
            if (s.visitorName) {
              existing.name = s.visitorName;
            }
          }
          // Keep isActive true if any session is active
          if (s.isActive) {
            existing.isActive = true;
          }
        } else {
          viewerMap.set(emailKey, {
            email: s.visitorEmail,
            name: s.visitorName,
            visits: 1,
            lastActive: s.lastActivityAt,
            totalTimeSpent: s.totalTimeSpentSeconds,
            linkName: s.link?.name ?? null,
            linkId: s.linkId,
            isActive: s.isActive,
          });
        }
      }

      const viewers = Array.from(viewerMap.values())
        .map((v) => ({
          email: v.email,
          name: v.name,
          visits: v.visits,
          lastActive: v.lastActive.toISOString(),
          totalTimeSpent: v.totalTimeSpent,
          linkName: v.linkName,
          linkId: v.linkId,
          isActive: v.isActive,
        }))
        .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());

      return { viewers, total: viewers.length };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[ViewersAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list viewers' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/viewers
 * Bulk invite viewers. If linkId is provided, add emails to that link's allowedEmails.
 * Otherwise, create a new VIEW-permission link scoped to each email.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = bulkInviteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { emails, linkId, inviteeName, inviteeCompany, message, expiresInDays } = parsed.data;
    const inviteExpiresAt = new Date(Date.now() + (expiresInDays ?? 14) * 24 * 60 * 60 * 1000);

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: { id: true, name: true },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      const normalizedEmails = emails.map((e) => e.toLowerCase().trim());
      let invited = 0;
      // Newly invited (email, link slug) to email after the transaction commits.
      const created: { email: string; slug: string }[] = [];

      if (linkId) {
        // Add emails to existing link's allowedEmails
        const link = await tx.link.findFirst({
          where: {
            id: linkId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!link) {
          return { error: 'Link not found', status: 404 };
        }

        const existingEmails = new Set(
          (link.allowedEmails ?? []).map((e: string) => e.toLowerCase())
        );
        const newEmails = normalizedEmails.filter((e) => !existingEmails.has(e));

        if (newEmails.length > 0) {
          await tx.link.update({
            where: { id: linkId },
            data: {
              allowedEmails: [...link.allowedEmails, ...newEmails],
              requiresEmailVerification: true,
            },
          });
          invited = newEmails.length;
          for (const email of newEmails) {
            created.push({ email, slug: link.slug });
          }
        }
      } else {
        // Create individual VIEW-permission links for each email
        for (const email of normalizedEmails) {
          const slug = randomBytes(16).toString('base64url');

          await tx.link.create({
            data: {
              organizationId: session.organizationId,
              roomId,
              createdByUserId: session.userId,
              slug,
              name: inviteeName ? `Viewer: ${inviteeName} (${email})` : `Viewer: ${email}`,
              permission: 'VIEW',
              requiresEmailVerification: true,
              allowedEmails: [email],
              scope: 'ENTIRE_ROOM',
              expiresAt: inviteExpiresAt,
              inviteeName: inviteeName || null,
              inviteeCompany: inviteeCompany || null,
              inviteMessage: message || null,
            },
          });
          created.push({ email, slug });
          invited += 1;
        }
      }

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'LINK_CREATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Bulk invited ${invited} viewer(s)`,
          metadata: {
            emails: normalizedEmails,
            linkId: linkId ?? null,
          },
        },
      });

      return { invited, created, roomName: room.name };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Send the invitation email to each newly invited address. Sending happens
    // outside the transaction and never fails the invite: if the email provider
    // is unconfigured (or errors), the link still exists and can be shared
    // manually. Configure EMAIL_PROVIDER=acs + ACS_CONNECTION_STRING to deliver.
    const inviterName =
      `${session.user.firstName ?? ''} ${session.user.lastName ?? ''}`.trim() || session.user.email;
    const baseUrl = new URL(request.url).origin;
    let emailsSent = 0;
    if (result.created.length > 0) {
      const email = getProviders().email;
      // Slugs whose invite email was actually delivered. Stamping
      // inviteEmailSentAt only for these makes the scheduled reminder job
      // eligible to nudge them later; a link we never emailed is never reminded.
      const sentSlugs: string[] = [];
      await Promise.all(
        result.created.map(async ({ email: to, slug }) => {
          try {
            const { subject, html } = buildInviteEmail({
              roomName: result.roomName,
              inviterName,
              inviteeName,
              message,
              link: `${baseUrl}/view/${slug}`,
              expiresAt: inviteExpiresAt,
            });
            await email.sendEmail({ to, subject, html });
            emailsSent += 1;
            sentSlugs.push(slug);
          } catch (err) {
            console.error(`[ViewersAPI] Failed to send invite email to ${to}:`, err);
          }
        })
      );

      if (sentSlugs.length > 0) {
        await withOrgContext(session.organizationId, async (tx) => {
          await tx.link.updateMany({
            where: { slug: { in: sentSlugs }, organizationId: session.organizationId },
            data: { inviteEmailSentAt: new Date() },
          });
        });
      }
    }

    return NextResponse.json({ invited: result.invited, emailsSent }, { status: 201 });
  } catch (error) {
    console.error('[ViewersAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to invite viewers' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId/viewers
 * Bulk revoke viewer access. Deactivates ViewSessions and removes from link allowedEmails.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = bulkRevokeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { emails } = parsed.data;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: { id: true },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      const normalizedEmails = emails.map((e) => e.toLowerCase().trim());

      // Deactivate all view sessions for these emails
      await tx.viewSession.updateMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          visitorEmail: { in: normalizedEmails },
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Remove emails from all link allowedEmails lists for this room
      const links = await tx.link.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          allowedEmails: { hasSome: normalizedEmails },
        },
      });

      for (const link of links) {
        const filteredEmails = link.allowedEmails.filter(
          (e: string) => !normalizedEmails.includes(e.toLowerCase())
        );
        await tx.link.update({
          where: { id: link.id },
          data: { allowedEmails: filteredEmails },
        });
      }

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'LINK_ACCESSED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Bulk revoked access for ${normalizedEmails.length} viewer(s)`,
          metadata: {
            emails: normalizedEmails,
            action: 'bulk_revoke',
          },
        },
      });

      return { revoked: normalizedEmails.length };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ revoked: result.revoked });
  } catch (error) {
    console.error('[ViewersAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to revoke viewer access' }, { status: 500 });
  }
}
