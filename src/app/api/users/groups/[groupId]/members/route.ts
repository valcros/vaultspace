/**
 * Group Members API Route
 *
 * POST /api/users/groups/:groupId/members - Add member to group
 * GET /api/users/groups/:groupId/members - List group members
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, requireAuth, getRequestContext } from '@/lib/middleware';
import { createServiceContext, groupService } from '@/services';
import { AppError, formatErrorResponse, ValidationError } from '@/lib/errors';
import { HTTP_STATUS } from '@/lib/constants';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * POST /api/users/groups/:groupId/members
 * Add a member to the group
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAdmin();
    const { groupId } = await context.params;
    const reqContext = getRequestContext(request);

    const body = await request.json();

    // Validate request body
    if (!body.userId || typeof body.userId !== 'string') {
      throw new ValidationError('userId is required');
    }

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const membership = await groupService.addMember(ctx, groupId, body.userId);

    return NextResponse.json(
      {
        success: true,
        membership: {
          id: membership.id,
          groupId: membership.groupId,
          userId: membership.userId,
          createdAt: membership.createdAt.toISOString(),
        },
      },
      { status: HTTP_STATUS.CREATED }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group member add error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

/**
 * GET /api/users/groups/:groupId/members
 * List members of the group
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { groupId } = await context.params;
    const reqContext = getRequestContext(request);

    const searchParams = request.nextUrl.searchParams;
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const result = await groupService.listMembers(ctx, groupId, {
      offset,
      limit,
    });

    // Format response
    const members = result.items.map((member) => ({
      userId: member.userId,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      joinedAt: member.joinedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      members,
      pagination: {
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group members list error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
