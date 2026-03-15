/**
 * User Groups API Route
 *
 * POST /api/users/groups - Create a new group
 * GET /api/users/groups - List all groups
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, requireAuth, getRequestContext } from '@/lib/middleware';
import { createServiceContext, groupService } from '@/services';
import { AppError, formatErrorResponse, ValidationError } from '@/lib/errors';
import { HTTP_STATUS } from '@/lib/constants';

/**
 * POST /api/users/groups
 * Create a new group
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const reqContext = getRequestContext(request);

    const body = await request.json();

    // Validate request body
    if (!body.name || typeof body.name !== 'string') {
      throw new ValidationError('Group name is required');
    }

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const group = await groupService.create(ctx, {
      name: body.name,
      description: body.description,
    });

    return NextResponse.json(
      {
        success: true,
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
          createdAt: group.createdAt.toISOString(),
          updatedAt: group.updatedAt.toISOString(),
        },
      },
      { status: HTTP_STATUS.CREATED }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group creation error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

/**
 * GET /api/users/groups
 * List all groups in the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const reqContext = getRequestContext(request);

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || undefined;
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const result = await groupService.list(ctx, {
      search,
      offset,
      limit,
    });

    // Format response
    const groups = result.items.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count.memberships,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      groups,
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
    console.error('Group list error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
