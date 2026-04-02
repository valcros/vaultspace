/**
 * Access Requests API (F027)
 *
 * GET /api/rooms/:roomId/access-requests - List access requests for a room (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'DENIED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/rooms/:roomId/access-requests
 * List access requests for a room (admin only)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query params
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, limit, offset } = parsed.data;

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
        return { error: 'Room not found', status: 404 };
      }

      // Build where clause
      const where = {
        roomId,
        organizationId: session.organizationId,
        ...(status && { status }),
      };

      // Get total count and access requests
      const [total, accessRequests] = await Promise.all([
        tx.accessRequest.count({ where }),
        tx.accessRequest.findMany({
          where,
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
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
      ]);

      return { accessRequests, total };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      accessRequests: result.accessRequests,
      total: result.total,
    });
  } catch (error) {
    console.error('[AccessRequestsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list access requests' }, { status: 500 });
  }
}
