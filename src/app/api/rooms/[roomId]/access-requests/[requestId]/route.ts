/**
 * Access Request Review API (F027)
 *
 * PATCH /api/rooms/:roomId/access-requests/:requestId - Approve or deny an access request
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; requestId: string }>;
}

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'DENIED']),
  reviewNote: z.string().max(2000).optional(),
});

/**
 * PATCH /api/rooms/:roomId/access-requests/:requestId
 * Admin reviews (approves or denies) an access request
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, requestId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = reviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, reviewNote } = parsed.data;

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 as const };
      }

      // Find the access request
      const accessRequest = await tx.accessRequest.findFirst({
        where: {
          id: requestId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!accessRequest) {
        return { error: 'Access request not found', status: 404 as const };
      }

      // Only pending requests can be reviewed
      if (accessRequest.status !== 'PENDING') {
        return { error: 'Access request has already been reviewed', status: 400 as const };
      }

      // Update the access request
      const updated = await tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status,
          reviewedByUserId: session.userId,
          reviewedAt: new Date(),
          reviewNote: reviewNote?.trim() || null,
        },
        include: {
          reviewedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // If approved, create a share link for the requester
      if (status === 'APPROVED') {
        const linkSlug = `ar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await tx.link.create({
          data: {
            organizationId: session.organizationId,
            roomId,
            createdByUserId: session.userId,
            slug: linkSlug,
            name: `Access Request: ${accessRequest.requesterEmail}`,
            permission: 'VIEW',
            requiresEmailVerification: true,
            allowedEmails: [accessRequest.requesterEmail],
            scope: 'ENTIRE_ROOM',
          },
        });
      }

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: status === 'APPROVED' ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Access request from ${accessRequest.requesterEmail} ${status.toLowerCase()}`,
          metadata: {
            accessRequestId: requestId,
            requesterEmail: accessRequest.requesterEmail,
            status,
            reviewNote: reviewNote || null,
          },
        },
      });

      return { accessRequest: updated };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ accessRequest: result.accessRequest });
  } catch (error) {
    console.error('[AccessRequestReviewAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to review access request' }, { status: 500 });
  }
}
