/**
 * User Management API (F052)
 *
 * GET    /api/users/:userId - Get user details
 * DELETE /api/users/:userId - GDPR delete user
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import {
  clearSessionCache,
  deactivateAllUserSessionsInTx,
  revokeAdminUserGlobalSingleOrgSessionsInTx,
  revokeAdminUserOrgSessionsInTx,
} from '@/lib/auth';
import { isAuthenticationError } from '@/lib/errors';
import { requireAuth, requireAuthCredential } from '@/lib/middleware';
import { bootstrapDb, withOrgContext } from '@/lib/db';
import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { lockPasswordResetUser } from '@/lib/auth/passwordResetToken';

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
      // Match password-reset issuance/redemption lock order so account
      // deactivation cannot race a newly minted flow or deadlock with it.
      await lockPasswordResetUser(tx, userId);
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.$queryRaw`
        SELECT 1
        FROM user_organizations uo
        JOIN organizations o ON o.id = uo."organizationId"
        WHERE uo."userId" = ${userId}
        FOR UPDATE OF uo, o`;
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

      const accountOrganizationIds = new Set(
        (
          await bootstrapDb.userOrganization.findMany({
            where: { userId },
            select: { organizationId: true },
          })
        ).map((membership) => membership.organizationId)
      );
      accountOrganizationIds.add(session.organizationId);

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

      const cancelledResetFlows = await tx.passwordResetToken.findMany({
        where: { userId, usedAt: null },
        select: { id: true, requestId: true },
      });
      if (cancelledResetFlows.length > 0) {
        const flowIds = cancelledResetFlows.map((flow) => flow.id);
        await tx.passwordResetToken.updateMany({
          where: { id: { in: flowIds } },
          data: { usedAt: new Date(), deliveryStatus: 'CANCELLED' },
        });
        await tx.passwordResetRecovery.updateMany({
          where: { flowId: { in: flowIds }, wipedAt: null },
          data: {
            cipherVersion: null,
            keyId: null,
            nonce: null,
            ciphertext: null,
            authTag: null,
            wipedAt: new Date(),
            enqueueStatus: 'ACCOUNT_DEACTIVATED',
          },
        });
        for (const organizationId of accountOrganizationIds) {
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
          for (const flow of cancelledResetFlows) {
            await createSecurityAuditEvent(tx, {
              organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'ADMIN',
              actorId: session.userId,
              actorEmail: session.user.email,
              requestId: flow.requestId ?? `recovery-${flow.id}`,
              correlationId: flow.id,
              idempotencyKey: `password-reset-${flow.id}-account-deactivated-${organizationId}`,
              description: 'Password reset flow was cancelled when the account was deactivated',
              metadata: {
                outcome: 'cancelled',
                stage: 'account_lifecycle',
                targetUserId: userId,
                errorCode: 'ACCOUNT_DEACTIVATED',
                initiatingOrganizationId: session.organizationId,
              },
            });
          }
        }
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${session.organizationId}, true)`;
      }

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

      const sessionIds = await deactivateAllUserSessionsInTx(tx, userId);

      return { success: true, sessionIds };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await clearSessionCache(result.sessionIds);

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
    const { session, token: actorToken } = await requireAuthCredential();
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
    // Column limits mirror prisma/schema.prisma so an overlong value returns a
    // 400 here instead of a generic 500 from a Postgres length violation.
    if (firstName !== undefined && (typeof firstName !== 'string' || !firstName.trim())) {
      return NextResponse.json({ error: 'First name cannot be empty' }, { status: 400 });
    }
    if (firstName !== undefined && firstName.trim().length > 100) {
      return NextResponse.json({ error: 'First name is too long' }, { status: 400 });
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || !lastName.trim())) {
      return NextResponse.json({ error: 'Last name cannot be empty' }, { status: 400 });
    }
    if (lastName !== undefined && lastName.trim().length > 100) {
      return NextResponse.json({ error: 'Last name is too long' }, { status: 400 });
    }
    if (title !== undefined && title !== null && typeof title !== 'string') {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }
    if (typeof title === 'string' && title.trim().length > 255) {
      return NextResponse.json({ error: 'Title is too long' }, { status: 400 });
    }
    let normalizedEmail: string | undefined;
    if (email !== undefined) {
      if (typeof email !== 'string') {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
      // Normalize before validating so a pasted address with surrounding
      // whitespace is accepted (matches the invite endpoint).
      normalizedEmail = email.toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 255) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Security-sensitive identity changes use the same global lock order as
      // reset issuance, delivery, redemption, and deletion.
      await lockPasswordResetUser(tx, userId);
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.$queryRaw`
        SELECT 1
        FROM user_organizations uo
        JOIN organizations o ON o.id = uo."organizationId"
        WHERE uo."userId" = ${userId}
        FOR UPDATE OF uo, o`;
      // Target must be a member of the caller's org (404 else — existence hiding).
      const userOrg = await tx.userOrganization.findFirst({
        where: { userId, organizationId: session.organizationId },
        include: { user: true },
      });
      if (!userOrg) {
        return { error: 'User not found in organization', status: 404 } as const;
      }

      const emailChanged = normalizedEmail !== undefined && normalizedEmail !== userOrg.user.email;
      const roleChanged = role !== undefined && role !== userOrg.role;
      const activeChanged = isActive !== undefined && isActive !== userOrg.isActive;
      const activeMembershipCount =
        isActive === false
          ? await bootstrapDb.userOrganization.count({
              where: {
                userId,
                isActive: true,
                organization: { isActive: true },
              },
            })
          : null;
      const finalActiveMembershipDeactivated =
        isActive === false && userOrg.isActive && activeMembershipCount !== null
          ? activeMembershipCount <= 1
          : false;

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
      // Only guard when the target is actually part of the counted admin set — a
      // globally deactivated admin membership cannot log in and is excluded from
      // the count below, so removing it can never reduce usable admins.
      const demotingAdmin = role !== undefined && role !== 'ADMIN' && userOrg.role === 'ADMIN';
      const deactivating = isActive === false && userOrg.isActive;
      if (
        (demotingAdmin || deactivating) &&
        userOrg.role === 'ADMIN' &&
        userOrg.isActive &&
        userOrg.user.isActive
      ) {
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

      let sessionIds: string[] = [];
      if (emailChanged || resetTwoFactor === true) {
        const revocation = await revokeAdminUserGlobalSingleOrgSessionsInTx(tx, actorToken, userId);
        if (!revocation) {
          return {
            error:
              'This user belongs to multiple organizations; their login email and two-factor cannot be changed here.',
            status: 403,
          } as const;
        }
        sessionIds = revocation.sessionIds;
      } else if (roleChanged || activeChanged) {
        const revocation = await revokeAdminUserOrgSessionsInTx(tx, actorToken, userId);
        if (!revocation) {
          return { error: 'User not found in organization', status: 404 } as const;
        }
        sessionIds = revocation.sessionIds;
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

      // When the login email moves, any outstanding reset link was delivered to
      // the OLD address. reset-password resolves tokens by userId (not email), so
      // an old-link holder could otherwise claim the account after the identity
      // moved. Consume all unused reset tokens in the same transaction.
      if (emailChanged || isActive === false) {
        const resetWhere =
          emailChanged || finalActiveMembershipDeactivated
            ? { userId, usedAt: null }
            : { userId, organizationId: session.organizationId, usedAt: null };
        const cancelledResetFlows = await tx.passwordResetToken.findMany({
          where: resetWhere,
          select: { id: true, requestId: true },
        });
        if (cancelledResetFlows.length > 0) {
          const flowIds = cancelledResetFlows.map((flow) => flow.id);
          const cancellationCode = emailChanged ? 'EMAIL_CHANGED' : 'MEMBERSHIP_DEACTIVATED';
          await tx.passwordResetToken.updateMany({
            where: { id: { in: flowIds } },
            data: { usedAt: new Date(), deliveryStatus: 'CANCELLED' },
          });
          await tx.passwordResetRecovery.updateMany({
            where: { flowId: { in: flowIds }, wipedAt: null },
            data: {
              cipherVersion: null,
              keyId: null,
              nonce: null,
              ciphertext: null,
              authTag: null,
              wipedAt: new Date(),
              enqueueStatus: cancellationCode,
            },
          });
          const auditOrganizationIds =
            emailChanged || finalActiveMembershipDeactivated
              ? new Set(
                  (
                    await bootstrapDb.userOrganization.findMany({
                      where: { userId },
                      select: { organizationId: true },
                    })
                  ).map((membership) => membership.organizationId)
                )
              : new Set([session.organizationId]);
          auditOrganizationIds.add(session.organizationId);
          for (const organizationId of auditOrganizationIds) {
            await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
            for (const flow of cancelledResetFlows) {
              await createSecurityAuditEvent(tx, {
                organizationId,
                eventType: 'USER_PASSWORD_RESET',
                actorType: 'ADMIN',
                actorId: session.userId,
                actorEmail: session.user.email,
                requestId: flow.requestId ?? `recovery-${flow.id}`,
                correlationId: flow.id,
                idempotencyKey: `password-reset-${flow.id}-${cancellationCode.toLowerCase()}-${organizationId}`,
                description: 'Password reset flow was cancelled by a user security change',
                metadata: {
                  outcome: 'cancelled',
                  stage: 'account_lifecycle',
                  targetUserId: userId,
                  errorCode: cancellationCode,
                  initiatingOrganizationId: session.organizationId,
                },
              });
            }
          }
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${session.organizationId}, true)`;
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
        sessionIds,
        selfInvalidated: userId === session.userId && sessionIds.includes(session.sessionId),
      } as const;
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.sessionIds.length > 0) {
      await clearSessionCache(result.sessionIds);
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
