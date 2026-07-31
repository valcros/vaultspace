/**
 * Admin-triggered Password Reset API
 *
 * POST /api/users/:userId/reset-password
 *
 * An org ADMIN sends a password-reset EMAIL to a member of their org. The admin
 * never sees or sets the password: this reuses the standard reset-token flow, so
 * the user completes the reset (and their sessions are invalidated) themselves.
 *
 * Guards mirror GET/PATCH on the parent route: admin else 403; target must be an
 * ACTIVE member of the caller's org (both the membership and the global account)
 * else 404 for a non-member (existence-hiding) or 400 for a deactivated one.
 *
 * Multi-org targets are allowed: the reset link is delivered only to the user's
 * own account email and redemption is bound to the token's userId, so this is
 * not a cross-tenant takeover vector (unlike email/2FA edits, which the PATCH
 * route blocks for multi-org users).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import { isAuthenticationError } from '@/lib/errors';
import { getRequestContext, requireAuth } from '@/lib/middleware';
import { bootstrapDb, withOrgContext } from '@/lib/db';
import { captureSecurityAudit, createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { getProviders } from '@/providers';
import { normalizeEmailError } from '@/providers/email/errors';
import { hasCapability } from '@/lib/deployment-capabilities';
import {
  JOB_NAMES,
  PASSWORD_RESET_EMAIL_JOB_OPTIONS,
  PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
  QUEUE_NAMES,
} from '@/workers/types';
import {
  createPasswordResetToken,
  getPasswordResetTokenWriteMode,
  lockPasswordResetUser,
  PasswordResetTokenConfigurationError,
  requirePasswordResetTokenSecret,
} from '@/lib/auth/passwordResetToken';
import {
  encryptPasswordResetRecoveryToken,
  PasswordResetRecoveryError,
  validatePasswordResetRecoveryConfiguration,
} from '@/lib/auth/passwordResetRecovery';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

// Minimum spacing between admin-triggered resets for the same target, so a
// double-click or abuse cannot mint an unbounded stream of valid tokens/emails.
const RESET_COOLDOWN_MS = 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const reqContext = getRequestContext(request);
    const { userId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const baseUrl = process.env['APP_URL'];
    if (!baseUrl) {
      console.error('[UserResetPasswordAPI] APP_URL must be configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    try {
      requirePasswordResetTokenSecret();
      if (getPasswordResetTokenWriteMode() === 'hmac') {
        validatePasswordResetRecoveryConfiguration();
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          component: 'admin-password-reset',
          event: 'configuration_check',
          outcome: 'failed',
          requestId: reqContext.requestId,
          errorCode:
            error instanceof PasswordResetTokenConfigurationError
              ? error.code
              : error instanceof PasswordResetRecoveryError
                ? error.code
                : 'PASSWORD_RESET_TOKEN_CONFIGURATION_INVALID',
        })
      );
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Fail fast when the platform cannot send email at all: an admin action must
    // not mint a token and report success when nothing will be delivered.
    const providers = getProviders();
    const canAsync = hasCapability('canSendAsyncEmail');
    const canSync = hasCapability('canSendSyncEmail');
    if (getPasswordResetTokenWriteMode() === 'hmac' && !canAsync) {
      console.error(
        JSON.stringify({
          component: 'admin-password-reset',
          event: 'configuration_check',
          outcome: 'failed',
          requestId: reqContext.requestId,
          errorCode: 'PASSWORD_RESET_RECOVERY_REQUIRES_ASYNC_EMAIL',
        })
      );
      return NextResponse.json(
        { error: 'HMAC password reset delivery requires the async worker' },
        { status: 503 }
      );
    }
    if (!canAsync && !canSync) {
      return NextResponse.json({ error: 'Email delivery is not configured' }, { status: 503 });
    }

    // Membership check, cooldown, token mint, per-org sender, and audit all run
    // in one org-scoped transaction so RLS enforces tenant isolation.
    const result = await withOrgContext(session.organizationId, async (tx) => {
      await lockPasswordResetUser(tx, userId);
      const userOrg = await tx.userOrganization.findFirst({
        where: { userId, organizationId: session.organizationId },
        include: {
          user: { select: { id: true, email: true, firstName: true, isActive: true } },
        },
      });
      if (!userOrg) {
        return { error: 'User not found in organization', status: 404 } as const;
      }
      // Both the org membership AND the global account must be active.
      if (!userOrg.isActive || !userOrg.user.isActive) {
        return {
          error: 'Cannot reset the password of a deactivated user',
          status: 400,
        } as const;
      }

      // All issuance paths lock the global user row first. This serializes
      // admin and self-service reset requests for the same account.
      await tx.$queryRaw`
        SELECT 1 FROM users
        WHERE id = ${userId}
        FOR UPDATE`;

      // Serialize concurrent resets for the same target so the cooldown check
      // below cannot be raced by two simultaneous requests (mirrors the PATCH
      // last-admin guard's row lock).
      await tx.$queryRaw`
        SELECT 1
        FROM user_organizations uo
        JOIN organizations o ON o.id = uo."organizationId"
        WHERE uo."userId" = ${userId} AND uo."organizationId" = ${session.organizationId}
        FOR UPDATE OF uo, o`;

      // The pre-lock lookup establishes a candidate only. Re-read recipient and
      // eligibility after both rows are locked so email changes, deactivation,
      // or membership removal cannot leave us sending a newly minted token to
      // stale account state.
      const lockedUserOrg = await tx.userOrganization.findFirst({
        where: { userId, organizationId: session.organizationId },
        include: {
          user: { select: { id: true, email: true, firstName: true, isActive: true } },
          organization: { select: { isActive: true } },
        },
      });
      if (!lockedUserOrg) {
        return { error: 'User not found in organization', status: 404 } as const;
      }
      if (
        !lockedUserOrg.isActive ||
        !lockedUserOrg.user.isActive ||
        !lockedUserOrg.organization.isActive
      ) {
        return {
          error: 'Cannot reset the password of a deactivated user',
          status: 400,
        } as const;
      }

      // Cooldown: skip if a fresh, unused token was just issued for this user.
      const recent = await tx.passwordResetToken.findFirst({
        where: {
          userId,
          usedAt: null,
          expiresAt: { gt: new Date() },
          createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        return {
          error: 'A password reset was just sent. Please wait a minute before retrying.',
          status: 429,
        } as const;
      }

      const tokenPair = createPasswordResetToken();
      const flowId = randomUUID();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const recoveryEnvelope =
        tokenPair.format === 'hmac'
          ? encryptPasswordResetRecoveryToken(tokenPair.publicToken, lockedUserOrg.user.email, {
              flowId,
              userId,
              storedToken: tokenPair.storedToken,
              expiresAt,
            })
          : null;

      const supersededResetFlows = await tx.passwordResetToken.findMany({
        where: { userId, usedAt: null },
        select: { id: true, requestId: true },
      });
      const auditOrganizationIds = new Set(
        (
          await bootstrapDb.userOrganization.findMany({
            where: { userId },
            select: { organizationId: true },
          })
        ).map((membership) => membership.organizationId)
      );
      auditOrganizationIds.add(session.organizationId);
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetRecovery.updateMany({
        where: { resetToken: { userId, usedAt: { not: null } }, wipedAt: null },
        data: {
          cipherVersion: null,
          keyId: null,
          nonce: null,
          ciphertext: null,
          authTag: null,
          wipedAt: new Date(),
          enqueueStatus: 'SUPERSEDED',
        },
      });

      await tx.passwordResetToken.create({
        data: {
          id: flowId,
          userId,
          token: tokenPair.storedToken,
          expiresAt,
          requestId: reqContext.requestId,
          organizationId: session.organizationId,
          deliveryStatus: 'PENDING',
        },
      });
      if (recoveryEnvelope) {
        await tx.passwordResetRecovery.create({
          data: {
            flowId,
            userId,
            recipientFingerprint: recoveryEnvelope.recipientFingerprint,
            cipherVersion: recoveryEnvelope.cipherVersion,
            keyId: recoveryEnvelope.keyId,
            nonce: recoveryEnvelope.nonce,
            ciphertext: recoveryEnvelope.ciphertext,
            authTag: recoveryEnvelope.authTag,
            providerOperationId: flowId,
          },
        });
      }

      const org = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: { name: true, emailSenderName: true, emailSenderAddress: true },
      });

      for (const organizationId of auditOrganizationIds) {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        // The reset is account-global, so each affected organization receives
        // the request fact as well as terminal facts for superseded flows.
        await createSecurityAuditEvent(tx, {
          organizationId,
          eventType: 'USER_PASSWORD_RESET',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          requestId: reqContext.requestId,
          correlationId: flowId,
          idempotencyKey: `password-reset-${flowId}-requested-${organizationId}`,
          description: 'Administrator requested an account-global password reset',
          metadata: {
            outcome: 'accepted',
            stage: 'request',
            targetUserId: userId,
            initiation: 'ADMIN',
            initiatingOrganizationId: session.organizationId,
          },
        });
        for (const superseded of supersededResetFlows) {
          await createSecurityAuditEvent(tx, {
            organizationId,
            eventType: 'USER_PASSWORD_RESET',
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user.email,
            requestId: superseded.requestId ?? `recovery-${superseded.id}`,
            correlationId: superseded.id,
            idempotencyKey: `password-reset-${superseded.id}-superseded-${organizationId}`,
            description: 'Password reset flow was superseded by a newer administrator request',
            metadata: {
              outcome: 'cancelled',
              stage: 'request_supersession',
              targetUserId: userId,
              replacementFlowId: flowId,
              errorCode: 'SUPERSEDED',
              initiatingOrganizationId: session.organizationId,
            },
          });
        }
      }
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${session.organizationId}, true)`;

      return {
        success: true as const,
        flowId,
        token: tokenPair.publicToken,
        recoverable: recoveryEnvelope !== null,
        user: lockedUserOrg.user,
        org,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Deliver via the per-org sender (falls back to the global sender when
    // unset). Unlike the anonymous forgot-password flow, an admin action DOES
    // surface delivery failures so the admin knows to retry.
    const orgName = result.org?.name || 'VaultSpace';
    const senderFrom = result.org?.emailSenderAddress || undefined;
    const senderName = result.org?.emailSenderName || result.org?.name || undefined;
    const resetUrlObject = new URL('/auth/reset-password', baseUrl);
    resetUrlObject.hash = new URLSearchParams({ token: result.token }).toString();
    const resetUrl = resetUrlObject.toString();

    try {
      if (canAsync) {
        const jobId = result.recoverable
          ? await providers.job.addJob(
              QUEUE_NAMES.NORMAL,
              JOB_NAMES.PASSWORD_RESET_DELIVER,
              { schemaVersion: 1, flowId: result.flowId, deliveryAttempt: 1 },
              {
                ...PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
                jobId: `password-reset-${result.flowId}-delivery-1`,
              }
            )
          : await providers.job.addJob(
              QUEUE_NAMES.NORMAL,
              JOB_NAMES.EMAIL_SEND,
              {
                to: result.user.email,
                subject: `Reset your ${orgName} password`,
                template: 'password-reset',
                from: senderFrom,
                fromName: senderName,
                data: {
                  userName: result.user.firstName || 'User',
                  organizationName: orgName,
                  resetUrl,
                  expiresIn: '1 hour',
                },
                passwordReset: {
                  flowId: result.flowId,
                  userId,
                  requestId: reqContext.requestId,
                  organizationIds: [session.organizationId],
                },
              },
              {
                ...PASSWORD_RESET_EMAIL_JOB_OPTIONS,
                jobId: `password-reset-${result.flowId}`,
              }
            );
        try {
          const transition = await bootstrapDb.passwordResetToken.updateMany({
            where: { id: result.flowId, usedAt: null, deliveryStatus: 'PENDING' },
            data: { deliveryStatus: 'QUEUED', queueJobId: jobId },
          });
          if (transition.count === 0) {
            await bootstrapDb.passwordResetToken.updateMany({
              where: { id: result.flowId, queueJobId: null },
              data: { queueJobId: jobId },
            });
          }
          if (result.recoverable) {
            await bootstrapDb.passwordResetRecovery.updateMany({
              where: { flowId: result.flowId, enqueueStatus: 'PENDING', wipedAt: null },
              data: { enqueueStatus: 'QUEUED' },
            });
          }
        } catch (lifecycleError) {
          // The job is already durable in Redis. Do not invalidate its token or
          // claim queue failure solely because the post-enqueue status write
          // failed; the worker can still advance the flow by its stable id.
          console.error(
            JSON.stringify({
              component: 'admin-password-reset',
              event: 'delivery_lifecycle_update',
              outcome: 'failed_after_queue_acceptance',
              requestId: reqContext.requestId,
              correlationId: result.flowId,
              jobId,
              errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
            })
          );
        }
      } else {
        const sendClaim = await bootstrapDb.passwordResetToken.updateMany({
          where: {
            id: result.flowId,
            usedAt: null,
            expiresAt: { gt: new Date() },
            deliveryStatus: 'PENDING',
          },
          data: {
            deliveryStatus: 'SENDING',
            deliveryAttempts: 1,
            lastDeliveryAttemptAt: new Date(),
          },
        });
        if (sendClaim.count !== 1) {
          console.warn(
            JSON.stringify({
              component: 'admin-password-reset',
              event: 'provider_submission',
              outcome: 'skipped_superseded_flow',
              requestId: reqContext.requestId,
              correlationId: result.flowId,
            })
          );
          return NextResponse.json(
            { error: 'This reset was superseded by a newer request. Please try again.' },
            { status: 409 }
          );
        }
        const sendResult = await providers.email.sendEmail({
          to: result.user.email,
          subject: `Reset your ${orgName} password`,
          html: `<p>Hi ${result.user.firstName || 'User'},</p><p>An administrator has requested a password reset for your account. Click <a href="${resetUrl}">here</a> to set a new password.</p><p>This link expires in 1 hour.</p>`,
          text: `Hi ${result.user.firstName || 'User'},\n\nAn administrator has requested a password reset for your account. Set a new password here: ${resetUrl}\n\nThis link expires in 1 hour.`,
          from: senderFrom,
          fromName: senderName,
          operationId: result.flowId,
          sensitiveContent: true,
        });
        // Once the provider accepts the submission, a later bookkeeping error
        // must not invalidate the delivered token or report a false delivery
        // failure to the administrator.
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            component: 'admin-password-reset',
            event: 'provider_submission',
            outcome: 'accepted',
            requestId: reqContext.requestId,
            correlationId: result.flowId,
            providerMessageId: sendResult.messageId,
          })
        );
        try {
          await bootstrapDb.$transaction(async (tx) => {
            await tx.passwordResetToken.updateMany({
              where: { id: result.flowId },
              data: {
                deliveryStatus: 'PROVIDER_ACCEPTED',
                provider: 'configured',
                providerOperationId: result.flowId,
                providerMessageId: sendResult.messageId,
                providerAcceptedAt: new Date(),
                lastDeliveryAttemptAt: new Date(),
              },
            });
            await tx.passwordResetRecovery.updateMany({
              where: { flowId: result.flowId, wipedAt: null },
              data: {
                cipherVersion: null,
                keyId: null,
                nonce: null,
                ciphertext: null,
                authTag: null,
                wipedAt: new Date(),
                enqueueStatus: 'PROVIDER_ACCEPTED',
              },
            });
            await tx.$executeRaw`SELECT set_config('app.current_org_id', ${session.organizationId}, true)`;
            await createSecurityAuditEvent(tx, {
              organizationId: session.organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'SYSTEM',
              requestId: reqContext.requestId,
              correlationId: result.flowId,
              idempotencyKey: `password-reset-${result.flowId}-accepted-${session.organizationId}`,
              description: 'Password reset email was accepted by the provider',
              metadata: {
                outcome: 'accepted',
                stage: 'provider_submission',
                targetUserId: userId,
                provider: 'configured',
                providerOperationId: result.flowId,
                providerMessageId: sendResult.messageId,
              },
            });
          });
        } catch (lifecycleError) {
          console.error(
            JSON.stringify({
              component: 'admin-password-reset',
              event: 'delivery_lifecycle_update',
              outcome: 'failed_after_provider_acceptance',
              requestId: reqContext.requestId,
              correlationId: result.flowId,
              providerMessageId: sendResult.messageId,
              errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
            })
          );
        }
      }
    } catch (emailErr) {
      const deliveryError = normalizeEmailError(emailErr, 'unknown');
      console.error(
        JSON.stringify({
          component: 'admin-password-reset',
          event: 'email_submission',
          outcome: 'failed',
          requestId: reqContext.requestId,
          correlationId: result.flowId,
          errorCode: deliveryError.code,
          retryable: deliveryError.retryable,
        })
      );
      if (canAsync && result.recoverable) {
        await bootstrapDb.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT 1 FROM password_reset_tokens
            WHERE id = ${result.flowId}
            FOR UPDATE`;
          await tx.$queryRaw`
            SELECT 1 FROM password_reset_recoveries
            WHERE "flowId" = ${result.flowId}
            FOR UPDATE`;
          const [resetState, recoveryState] = await Promise.all([
            tx.passwordResetToken.findUnique({
              where: { id: result.flowId },
              select: { deliveryStatus: true, providerAcceptedAt: true },
            }),
            tx.passwordResetRecovery.findUnique({
              where: { flowId: result.flowId },
              select: { enqueueStatus: true, wipedAt: true },
            }),
          ]);
          if (
            resetState?.deliveryStatus !== 'PENDING' ||
            resetState.providerAcceptedAt ||
            recoveryState?.enqueueStatus !== 'PENDING' ||
            recoveryState.wipedAt
          ) {
            return;
          }
          await tx.passwordResetToken.update({
            where: { id: result.flowId },
            data: { deliveryStatus: 'QUEUE_RETRYING', deliveryErrorCode: 'EMAIL_QUEUE_ERROR' },
          });
          await tx.passwordResetRecovery.update({
            where: { flowId: result.flowId },
            data: {
              enqueueStatus: 'QUEUE_RETRYING',
              enqueueAttempts: { increment: 1 },
              nextEnqueueAt: new Date(Date.now() + 30_000),
            },
          });
          await createSecurityAuditEvent(tx, {
            organizationId: session.organizationId,
            eventType: 'USER_PASSWORD_RESET',
            actorType: 'SYSTEM',
            requestId: reqContext.requestId,
            correlationId: result.flowId,
            idempotencyKey: `password-reset-${result.flowId}-queue-recovery-pending-${session.organizationId}`,
            description: 'Password reset email is pending queue recovery',
            metadata: {
              outcome: 'pending',
              stage: 'queue',
              targetUserId: userId,
              errorCode: 'EMAIL_QUEUE_ERROR',
            },
          });
        });
        return NextResponse.json({ success: true, deliveryPending: true }, { status: 202 });
      }
      // Neutralize the undelivered token so it cannot linger for an hour and so
      // an immediate retry is not blocked by the cooldown. The tx above is
      // closed, so use a fresh handle; best-effort. (password_reset_tokens has
      // no RLS, so bootstrapDb is appropriate here.)
      try {
        const acceptanceUnknown = !canAsync && deliveryError.retryable;
        await bootstrapDb.passwordResetToken.updateMany({
          where: { id: result.flowId, usedAt: null },
          data: {
            ...(acceptanceUnknown ? {} : { usedAt: new Date() }),
            deliveryStatus: canAsync
              ? 'QUEUE_FAILED'
              : deliveryError.retryable
                ? 'ACCEPTANCE_UNKNOWN'
                : 'FAILED_PERMANENT',
            deliveryErrorCode: deliveryError.code,
          },
        });
        if (result.recoverable) {
          await bootstrapDb.passwordResetRecovery.updateMany({
            where: { flowId: result.flowId, wipedAt: null },
            data: {
              cipherVersion: null,
              keyId: null,
              nonce: null,
              ciphertext: null,
              authTag: null,
              wipedAt: new Date(),
              enqueueStatus: deliveryError.retryable ? 'ACCEPTANCE_UNKNOWN' : 'FAILED_PERMANENT',
            },
          });
        }
      } catch (cleanupErr) {
        console.error(
          JSON.stringify({
            component: 'admin-password-reset',
            event: 'undelivered_token_invalidation',
            outcome: 'failed',
            requestId: reqContext.requestId,
            correlationId: result.flowId,
            errorName: cleanupErr instanceof Error ? cleanupErr.name : 'UnknownError',
          })
        );
      }
      await captureSecurityAudit({
        organizationId: session.organizationId,
        eventType: 'USER_PASSWORD_RESET',
        actorType: 'SYSTEM',
        requestId: reqContext.requestId,
        correlationId: result.flowId,
        description: 'Password reset email could not be queued or submitted',
        metadata: {
          outcome: 'failure',
          stage: canAsync ? 'queue' : 'provider_submission',
          targetUserId: userId,
          errorCode: deliveryError.code,
          retryable: deliveryError.retryable,
        },
      });
      return NextResponse.json(
        { error: 'Could not send the reset email. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error(
      JSON.stringify({
        component: 'admin-password-reset',
        event: 'request_processing',
        outcome: 'failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Failed to send password reset' }, { status: 500 });
  }
}
