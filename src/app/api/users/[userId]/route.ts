/**
 * User Management API (F052)
 *
 * GET    /api/users/:userId - Get user details
 * DELETE /api/users/:userId - GDPR delete user
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { clearSessionCache, deactivateAllUserSessionsInTx } from '@/lib/auth';
import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { bootstrapDb, withOrgContext } from '@/lib/db';

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
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}

/**
 * DELETE /api/users/:userId
 * GDPR-compliant user deletion
 * - Soft deletes user
 * - Preserves immutable audit events
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

      // 3. Preserve audit events as append-only records. The user row was redacted above.

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
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

/**
 * PATCH /api/users/:userId
 * Admin edit of a user's attributes. Name/title/email live on the global User;
 * role/active live on the per-org membership. Security-sensitive: see
 * docs/ADMIN_USER_MANAGEMENT_PLAN.md.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { firstName, lastName, title, email, role, isActive, resetTwoFactor } = body;

    // Validate provided fields.
    if (role !== undefined && role !== 'ADMIN' && role !== 'VIEWER') {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
    }
    if (firstName !== undefined && (typeof firstName !== 'string' || !firstName.trim())) {
      return NextResponse.json({ error: 'First name cannot be empty' }, { status: 400 });
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || !lastName.trim())) {
      return NextResponse.json({ error: 'Last name cannot be empty' }, { status: 400 });
    }
    let normalizedEmail: string | undefined;
    if (email !== undefined) {
      if (typeof email !== 'string') {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
      // Normalize before validating so a pasted address with surrounding
      // whitespace is accepted (matches the invite endpoint).
      normalizedEmail = email.toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
    }

    // Cross-org membership count (bypasses RLS to see the user's other orgs);
    // used for the shared-login-identity protection below.
    const orgMembershipCount = await bootstrapDb.userOrganization.count({ where: { userId } });

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Target must be a member of the caller's org (404 else — existence hiding).
      const userOrg = await tx.userOrganization.findFirst({
        where: { userId, organizationId: session.organizationId },
        include: { user: true },
      });
      if (!userOrg) {
        return { error: 'User not found in organization', status: 404 } as const;
      }

      const emailChanged = normalizedEmail !== undefined && normalizedEmail !== userOrg.user.email;

      // Cross-tenant protection: an org admin must not change a shared login
      // identity (global email) or 2FA for a user who belongs to OTHER orgs —
      // otherwise they could redirect a password reset and take over that user
      // elsewhere.
      if ((emailChanged || resetTwoFactor === true) && orgMembershipCount > 1) {
        return {
          error:
            'This user belongs to multiple organizations; their login email and two-factor cannot be changed here.',
          status: 403,
        } as const;
      }

      // The /api/users status is combined (membership AND global account); only
      // the membership flag is editable here, so refuse to "activate" a globally
      // deactivated account (which would return 200 but stay inactive).
      if (isActive === true && !userOrg.user.isActive) {
        return {
          error: 'This user account is deactivated and cannot be reactivated here.',
          status: 400,
        } as const;
      }

      // Last-admin lockout: never demote/deactivate the org's only active admin.
      const demotingAdmin = role !== undefined && role !== 'ADMIN' && userOrg.role === 'ADMIN';
      const deactivating = isActive === false && userOrg.isActive;
      if ((demotingAdmin || deactivating) && userOrg.role === 'ADMIN' && userOrg.isActive) {
        // Lock the org's active admin memberships so concurrent demotions
        // serialize and cannot both pass the count check.
        await tx.$queryRaw`
          SELECT 1 FROM user_organizations
          WHERE "organizationId" = ${session.organizationId}
            AND role::text = 'ADMIN' AND "isActive" = true
          FOR UPDATE`;
        const activeAdmins = await tx.userOrganization.count({
          where: {
            organizationId: session.organizationId,
            role: 'ADMIN',
            isActive: true,
            // A membership whose global account is disabled cannot actually log
            // in, so it must not count toward the last-admin guard.
            user: { isActive: true },
          },
        });
        if (activeAdmins <= 1) {
          return {
            error: 'Cannot demote or deactivate the last active admin of the organization',
            status: 400,
          } as const;
        }
      }

      // Global User fields (name / title / email / 2FA reset).
      const userData: Prisma.UserUpdateInput = {};
      if (firstName !== undefined) {
        userData.firstName = firstName.trim();
      }
      if (lastName !== undefined) {
        userData.lastName = lastName.trim();
      }
      if (title !== undefined) {
        userData.title = (title || '').trim() || null;
      }
      if (normalizedEmail !== undefined) {
        userData.email = normalizedEmail;
      }
      if (resetTwoFactor === true) {
        userData.twoFactorEnabled = false;
        userData.twoFactorSecret = null;
        userData.twoFactorBackupCodes = { set: [] };
      }
      if (Object.keys(userData).length > 0) {
        try {
          await tx.user.update({ where: { id: userId }, data: userData });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { error: 'That email address is already in use', status: 409 } as const;
          }
          throw e;
        }
      }

      // Per-org membership fields (role / active).
      const memData: Prisma.UserOrganizationUpdateInput = {};
      if (role !== undefined) {
        memData.role = role;
      }
      if (isActive !== undefined) {
        memData.isActive = isActive;
      }
      if (Object.keys(memData).length > 0) {
        await tx.userOrganization.update({ where: { id: userOrg.id }, data: memData });
      }

      // Invalidate sessions when a security-relevant attribute changed.
      const roleChanged = role !== undefined && role !== userOrg.role;
      const activeChanged = isActive !== undefined && isActive !== userOrg.isActive;
      let sessionTokens: string[] = [];
      if (roleChanged || activeChanged || emailChanged || resetTwoFactor === true) {
        sessionTokens = await deactivateAllUserSessionsInTx(tx, userId);
      }

      // Record only fields whose values actually changed (accurate audit trail).
      const firstNameChanged =
        firstName !== undefined && firstName.trim() !== userOrg.user.firstName;
      const lastNameChanged = lastName !== undefined && lastName.trim() !== userOrg.user.lastName;
      const titleChanged =
        title !== undefined && ((title || '').trim() || null) !== userOrg.user.title;
      const changedFields = [
        ...(firstNameChanged ? ['firstName'] : []),
        ...(lastNameChanged ? ['lastName'] : []),
        ...(titleChanged ? ['title'] : []),
        ...(emailChanged ? ['email'] : []),
        ...(roleChanged ? ['role'] : []),
        ...(activeChanged ? ['isActive'] : []),
        ...(resetTwoFactor === true ? ['twoFactorReset'] : []),
      ];
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'USER_UPDATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          description: `Updated user ${userOrg.user.email}`,
          metadata: { targetUserId: userId, fields: changedFields },
        },
      });

      return {
        success: true,
        sessionTokens,
        selfInvalidated: userId === session.userId && sessionTokens.length > 0,
      } as const;
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.sessionTokens.length > 0) {
      await clearSessionCache(result.sessionTokens);
    }

    return NextResponse.json({ success: true, selfSessionInvalidated: result.selfInvalidated });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
