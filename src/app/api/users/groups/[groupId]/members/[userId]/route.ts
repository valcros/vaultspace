/**
 * Individual Group Member API Route
 *
 * DELETE /api/users/groups/:groupId/members/:userId - Remove member from group
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, getRequestContext } from '@/lib/middleware';
import { createServiceContext, groupService } from '@/services';
import { AppError, formatErrorResponse } from '@/lib/errors';
import { HTTP_STATUS } from '@/lib/constants';

interface RouteContext {
  params: Promise<{ groupId: string; userId: string }>;
}

/**
 * DELETE /api/users/groups/:groupId/members/:userId
 * Remove a member from the group
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAdmin();
    const { groupId, userId } = await context.params;
    const reqContext = getRequestContext(request);

    // Create service context
    const ctx = createServiceContext({
      session,
      requestId: reqContext.requestId,
      ipAddress: reqContext.ipAddress,
      userAgent: reqContext.userAgent,
    });

    await groupService.removeMember(ctx, groupId, userId);

    return NextResponse.json({
      success: true,
      message: 'Member removed from group successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    console.error('Group member remove error:', error);
    return NextResponse.json(formatErrorResponse(error), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}
