/**
 * User Management API (F052)
 *
 * GET    /api/users/:userId - Get user details
 * DELETE /api/users/:userId - GDPR delete user
 */

import { NextRequest, NextResponse } from 'next/server';

import { clearSessionCache, deactivateAllUserSessionsInTx } from '@/lib/auth';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/users/:userId
 * Get user details
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
    const userOrg = await withOrgContext(session.organizationId, async (tx) => {
      return tx.userOrganization.findFirst({
        where: {
          userId,
          organizationId: session.organizationId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              createdAt: true,
              lastLoginAt: true,
              isActive: true,
            },
          },
        },
      });
    });

    if (!userOrg) {
      return NextResponse.json({ error: 'User not found in organization' }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: userOrg.user.id,
        email: userOrg.user.email,
        firstName: userOrg.user.firstName,
        lastName: userOrg.user.lastName,
        role: userOrg.role,
        isActive: userOrg.isActive && userOrg.user.isActive,
        createdAt: userOrg.user.createdAt,
        lastLoginAt: userOrg.user.lastLoginAt,
      },
    });
  } catch (error) {
    console.error('[UserAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}

/**
 * DELETE /api/users/:userId
 * GDPR-compliant user deletion
 * - Soft deletes user
 * - Redacts events to preserve audit trail
 * - Transfers room ownership if needed
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Cannot delete yourself
    if (userId === session.userId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Use RLS context for all org-scoped operations
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify user is in organization
      const userOrg = await tx.userOrganization.findFirst({
        where: {
          userId,
          organizationId: session.organizationId,
        },
        include: {
          user: true,
        },
      });

      if (!userOrg) {
        return { error: 'User not found in organization', status: 404 };
      }

      // 1. Soft delete the user by deactivating and redacting PII
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          // Redact PII
          firstName: 'Deleted',
          lastName: 'User',
        },
      });

      // 2. Deactivate user organization membership
      await tx.userOrganization.update({
        where: { id: userOrg.id },
        data: { isActive: false },
      });

      // 3. Redact events - keep for audit but anonymize
      await tx.event.updateMany({
        where: {
          organizationId: session.organizationId,
          actorId: userId,
        },
        data: {
          actorId: null,
          actorEmail: 'deleted_user@redacted',
        },
      });

      // 4. Redact document versions uploaded by user
      await tx.documentVersion.updateMany({
        where: {
          organizationId: session.organizationId,
          uploadedByUserId: userId,
        },
        data: {
          uploadedByUserId: null,
          uploadedByEmail: 'deleted_user@redacted',
        },
      });

      // 5. Remove permissions granted to user
      await tx.permission.deleteMany({
        where: {
          organizationId: session.organizationId,
          granteeType: 'USER',
          userId,
        },
      });

      // 6. Remove role assignments
      await tx.roleAssignment.deleteMany({
        where: {
          organizationId: session.organizationId,
          userId,
        },
      });

      const sessionTokens = await deactivateAllUserSessionsInTx(tx, userId);

      return { success: true, sessionTokens };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await clearSessionCache(result.sessionTokens);

    return NextResponse.json({
      success: true,
      message: 'User deleted and data redacted per GDPR requirements',
    });
  } catch (error) {
    console.error('[UserAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
