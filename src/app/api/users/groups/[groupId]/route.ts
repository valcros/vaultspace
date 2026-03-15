/**
 * Individual Group API Route
 *
 * GET /api/users/groups/:groupId - Get group details
 * PATCH /api/users/groups/:groupId - Update group
 * DELETE /api/users/groups/:groupId - Delete group
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, requireAuth, getRequestContext } from '@/lib/middleware';
import { createServiceContext, groupService } from '@/services';
import { AppError, formatErrorResponse, NotFoundError } from '@/lib/errors';
import { HTTP_STATUS } from '@/lib/constants';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * GET /api/users/groups/:groupId
 * Get group details
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { groupId } = await context.params;
    const reqContext = getRequestContext(request);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const group = await groupService.getById(ctx, groupId);

    if (!group) {
      throw new NotFoundError('Group');
    }

    return NextResponse.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        memberCount: group._count.memberships,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group get error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

/**
 * PATCH /api/users/groups/:groupId
 * Update group
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAdmin();
    const { groupId } = await context.params;
    const reqContext = getRequestContext(request);

    const body = await request.json();

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    const group = await groupService.update(ctx, groupId, {
      name: body.name,
      description: body.description,
    });

    return NextResponse.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group update error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

/**
 * DELETE /api/users/groups/:groupId
 * Delete group
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAdmin();
    const { groupId } = await context.params;
    const reqContext = getRequestContext(request);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    await groupService.delete(ctx, groupId);

    return NextResponse.json({
      success: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group delete error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
