/**
 * Forgot Password API (F004)
 *
 * POST /api/auth/forgot-password - Request password reset
 */

import { createHmac, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { captureSecurityAudit, createSecurityAuditEvent } from '@/lib/audit/securityAudit';
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
import { bootstrapDb as db } from '@/lib/db';
import { hasCapability } from '@/lib/deployment-capabilities';
import { RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters } from '@/lib/middleware';
import { getProviders } from '@/providers';
import { normalizeEmailError } from '@/providers/email/errors';
import {
  JOB_NAMES,
  PASSWORD_RESET_EMAIL_JOB_OPTIONS,
  PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
  QUEUE_NAMES,
} from '@/workers/types';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const TOKEN_TTL_MS = 60 * 60 * 1000;
const MINIMUM_RESPONSE_MS = 150;

function structuredLog(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ component: 'forgot-password', ...fields }));
}

async function neutralResponse(startedAt: number): Promise<NextResponse> {
  const remaining = MINIMUM_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const reqContext = getRequestContext(request);
  const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
  const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);
    const normalizedEmail = email.toLowerCase();
    const baseUrl = process.env['APP_URL'];
    const fingerprintSecret = process.env['SESSION_SECRET'];

    // Configuration checks occur before account lookup so status cannot reveal
    // whether an address belongs to a known user.
    if (!baseUrl || !fingerprintSecret?.trim()) {
      structuredLog({
        event: 'configuration_check',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorCode: !baseUrl ? 'APP_URL_MISSING' : 'SESSION_SECRET_MISSING',
      });
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    try {
      requirePasswordResetTokenSecret();
      if (getPasswordResetTokenWriteMode() === 'hmac') {
        validatePasswordResetRecoveryConfiguration();
        if (!hasCapability('canSendAsyncEmail')) {
          structuredLog({
            event: 'configuration_check',
            outcome: 'failed',
            requestId: reqContext.requestId,
            errorCode: 'PASSWORD_RESET_RECOVERY_REQUIRES_ASYNC_EMAIL',
          });
          return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
      }
    } catch (error) {
      structuredLog({
        event: 'configuration_check',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorCode:
          error instanceof PasswordResetTokenConfigurationError
            ? error.code
            : error instanceof PasswordResetRecoveryError
              ? error.code
              : 'PASSWORD_RESET_TOKEN_CONFIGURATION_INVALID',
      });
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const emailFingerprint = createHmac('sha256', fingerprintSecret)
      .update(normalizedEmail)
      .digest('hex');

    try {
      await Promise.all([
        rateLimiters.passwordResetByEmailFingerprint(emailFingerprint),
        rateLimiters.passwordResetByIp(ipAddress ?? 'unknown'),
      ]);
    } catch (error) {
      structuredLog({
        event: 'rate_limit_check',
        outcome: error instanceof RateLimitError ? 'limited' : 'failed_closed',
        requestId: reqContext.requestId,
        errorCode: error instanceof RateLimitError ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE',
      });
      return neutralResponse(startedAt);
    }

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organizations: {
          where: { isActive: true, organization: { isActive: true } },
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                emailSenderName: true,
                emailSenderAddress: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || !user.isActive) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          component: 'forgot-password',
          event: 'request_accepted',
          outcome: 'neutral',
          requestId: reqContext.requestId,
        })
      );
      return neutralResponse(startedAt);
    }

    // A reset is an account-global security mutation, but the immutable Event
    // model is tenant-scoped. Do not mint an unaudited reset for an orphaned
    // active account that has no active organization membership.
    if (user.organizations.length === 0) {
      console.warn(
        JSON.stringify({
          component: 'forgot-password',
          event: 'request_accepted',
          outcome: 'neutral_orphan_account',
          requestId: reqContext.requestId,
          errorCode: 'NO_ACTIVE_ORGANIZATION',
        })
      );
      return neutralResponse(startedAt);
    }

    try {
      const flowId = randomUUID();
      const tokenPair = createPasswordResetToken();
      const resetToken = tokenPair.publicToken;
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const recoveryEnvelope =
        tokenPair.format === 'hmac'
          ? encryptPasswordResetRecoveryToken(resetToken, normalizedEmail, {
              flowId,
              userId: user.id,
              storedToken: tokenPair.storedToken,
              expiresAt,
            })
          : null;

      const issuance = await db.$transaction(async (tx) => {
        await lockPasswordResetUser(tx, user.id);
        // Serialize self-service and administrator issuance for this account.
        // Every issuance path takes the same global user lock, supersedes older
        // unused links, and only then creates the new flow.
        await tx.$queryRaw`
          SELECT 1 FROM users
          WHERE id = ${user.id}
          FOR UPDATE`;

        // Lock membership and organization eligibility before resolving the
        // authoritative recipient and audit targets. The initial email lookup
        // is candidate discovery only and may be stale by the time this lock is
        // acquired.
        await tx.$queryRaw`
          SELECT 1
          FROM user_organizations uo
          JOIN organizations o ON o.id = uo."organizationId"
          WHERE uo."userId" = ${user.id}
          FOR UPDATE OF uo, o`;
        const lockedUser = await tx.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            firstName: true,
            isActive: true,
            organizations: {
              where: { isActive: true, organization: { isActive: true } },
              include: {
                organization: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    emailSenderName: true,
                    emailSenderAddress: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        if (
          !lockedUser ||
          !lockedUser.isActive ||
          lockedUser.email.toLowerCase() !== normalizedEmail ||
          lockedUser.organizations.length === 0
        ) {
          return null;
        }

        const lockedMemberships = lockedUser.organizations;
        const hostnameOrg = reqContext.customDomain.orgSlug
          ? lockedMemberships.find(
              (membership) => membership.organization.slug === reqContext.customDomain.orgSlug
            )
          : undefined;
        const lockedSenderOrg =
          hostnameOrg ?? (lockedMemberships.length === 1 ? lockedMemberships[0] : undefined);

        const supersededResetFlows = await tx.passwordResetToken.findMany({
          where: { userId: lockedUser.id, usedAt: null },
          select: { id: true, requestId: true },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: lockedUser.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetRecovery.updateMany({
          where: { resetToken: { userId: lockedUser.id, usedAt: { not: null } }, wipedAt: null },
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
            userId: lockedUser.id,
            token: tokenPair.storedToken,
            expiresAt,
            requestId: reqContext.requestId,
            organizationId: lockedSenderOrg?.organization.id ?? null,
            deliveryStatus: 'PENDING',
          },
        });
        if (recoveryEnvelope) {
          await tx.passwordResetRecovery.create({
            data: {
              flowId,
              userId: lockedUser.id,
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

        for (const membership of lockedMemberships) {
          await createSecurityAuditEvent(tx, {
            organizationId: membership.organization.id,
            eventType: 'USER_PASSWORD_RESET',
            actorType: 'SYSTEM',
            requestId: reqContext.requestId,
            correlationId: flowId,
            description: 'Password reset requested for an organization member',
            metadata: {
              outcome: 'accepted',
              stage: 'request',
              targetUserId: lockedUser.id,
              initiation: 'SELF_SERVICE',
            },
            ipAddress,
            userAgent,
          });
          for (const superseded of supersededResetFlows) {
            await createSecurityAuditEvent(tx, {
              organizationId: membership.organization.id,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'SYSTEM',
              requestId: superseded.requestId ?? `recovery-${superseded.id}`,
              correlationId: superseded.id,
              idempotencyKey: `password-reset-${superseded.id}-superseded-${membership.organization.id}`,
              description: 'Password reset flow was superseded by a newer request',
              metadata: {
                outcome: 'cancelled',
                stage: 'request_supersession',
                targetUserId: lockedUser.id,
                replacementFlowId: flowId,
                errorCode: 'SUPERSEDED',
              },
              ipAddress,
              userAgent,
            });
          }
        }

        return { user: lockedUser, memberships: lockedMemberships, senderOrg: lockedSenderOrg };
      });

      if (!issuance) {
        structuredLog({
          event: 'locked_eligibility_check',
          outcome: 'neutral_stale_candidate',
          requestId: reqContext.requestId,
          correlationId: flowId,
        });
        return neutralResponse(startedAt);
      }

      const deliveryUser = issuance.user;
      const memberships = issuance.memberships;
      const senderOrg = issuance.senderOrg;
      const organizationIds = memberships.map((membership) => membership.organization.id);

      const providers = getProviders();
      const orgName = senderOrg?.organization.name ?? 'VaultSpace';
      const senderFrom = senderOrg?.organization.emailSenderAddress || undefined;
      const senderName =
        senderOrg?.organization.emailSenderName || senderOrg?.organization.name || undefined;
      const resetUrlObject = new URL('/auth/reset-password', baseUrl);
      resetUrlObject.hash = new URLSearchParams({ token: resetToken }).toString();
      const resetUrl = resetUrlObject.toString();
      const captureDeliveryFailure = async (
        stage: 'queue' | 'provider_submission' | 'configuration',
        errorCode: string,
        retryable?: boolean
      ) =>
        Promise.all(
          organizationIds.map((organizationId) =>
            captureSecurityAudit({
              organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'SYSTEM',
              requestId: reqContext.requestId,
              correlationId: flowId,
              description: 'Password reset email could not be submitted',
              metadata: {
                outcome: 'failure',
                stage,
                targetUserId: deliveryUser.id,
                errorCode,
                ...(retryable === undefined ? {} : { retryable }),
              },
            })
          )
        );

      if (hasCapability('canSendAsyncEmail')) {
        try {
          const jobId = recoveryEnvelope
            ? await providers.job.addJob(
                QUEUE_NAMES.NORMAL,
                JOB_NAMES.PASSWORD_RESET_DELIVER,
                { schemaVersion: 1, flowId, deliveryAttempt: 1 },
                {
                  ...PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
                  jobId: `password-reset-${flowId}-delivery-1`,
                }
              )
            : await providers.job.addJob(
                QUEUE_NAMES.NORMAL,
                JOB_NAMES.EMAIL_SEND,
                {
                  to: deliveryUser.email,
                  subject: `Reset your ${orgName} password`,
                  template: 'password-reset',
                  from: senderFrom,
                  fromName: senderName,
                  data: {
                    userName: deliveryUser.firstName || 'User',
                    organizationName: orgName,
                    resetUrl,
                    expiresIn: '1 hour',
                  },
                  passwordReset: {
                    flowId,
                    userId: deliveryUser.id,
                    requestId: reqContext.requestId,
                    organizationIds,
                  },
                },
                {
                  ...PASSWORD_RESET_EMAIL_JOB_OPTIONS,
                  jobId: `password-reset-${flowId}`,
                }
              );
          try {
            const transition = await db.passwordResetToken.updateMany({
              where: { id: flowId, usedAt: null, deliveryStatus: 'PENDING' },
              data: { deliveryStatus: 'QUEUED', queueJobId: jobId },
            });

            // A very fast worker can advance the flow before addJob returns.
            // Keep job correlation without regressing a later lifecycle state.
            if (transition.count === 0) {
              await db.passwordResetToken.updateMany({
                where: { id: flowId, queueJobId: null },
                data: { queueJobId: jobId },
              });
            }
            if (recoveryEnvelope) {
              await db.passwordResetRecovery.updateMany({
                where: { flowId, enqueueStatus: 'PENDING', wipedAt: null },
                data: { enqueueStatus: 'QUEUED' },
              });
            }
          } catch (lifecycleError) {
            structuredLog({
              event: 'delivery_lifecycle_update',
              outcome: 'failed_after_queue_acceptance',
              requestId: reqContext.requestId,
              correlationId: flowId,
              jobId,
              errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
            });
          }

          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              component: 'forgot-password',
              event: 'email_queued',
              outcome: 'queued',
              requestId: reqContext.requestId,
              correlationId: flowId,
              jobId,
            })
          );
        } catch (error) {
          if (recoveryEnvelope) {
            await db.$transaction(async (tx) => {
              await tx.$queryRaw`
                SELECT 1 FROM password_reset_tokens
                WHERE id = ${flowId}
                FOR UPDATE`;
              await tx.$queryRaw`
                SELECT 1 FROM password_reset_recoveries
                WHERE "flowId" = ${flowId}
                FOR UPDATE`;
              const [resetState, recoveryState] = await Promise.all([
                tx.passwordResetToken.findUnique({
                  where: { id: flowId },
                  select: { deliveryStatus: true, providerAcceptedAt: true },
                }),
                tx.passwordResetRecovery.findUnique({
                  where: { flowId },
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
                where: { id: flowId },
                data: {
                  deliveryStatus: 'QUEUE_RETRYING',
                  deliveryErrorCode: 'EMAIL_QUEUE_ERROR',
                },
              });
              await tx.passwordResetRecovery.update({
                where: { flowId },
                data: {
                  enqueueStatus: 'QUEUE_RETRYING',
                  enqueueAttempts: { increment: 1 },
                  nextEnqueueAt: new Date(Date.now() + 30_000),
                },
              });
              await Promise.all(
                organizationIds.map((organizationId) =>
                  createSecurityAuditEvent(tx, {
                    organizationId,
                    eventType: 'USER_PASSWORD_RESET',
                    actorType: 'SYSTEM',
                    requestId: reqContext.requestId,
                    correlationId: flowId,
                    idempotencyKey: `password-reset-${flowId}-queue-recovery-pending-${organizationId}`,
                    description: 'Password reset email is pending queue recovery',
                    metadata: {
                      outcome: 'pending',
                      stage: 'queue',
                      targetUserId: deliveryUser.id,
                      errorCode: 'EMAIL_QUEUE_ERROR',
                    },
                  })
                )
              );
            });
          } else {
            await db.passwordResetToken.updateMany({
              where: { id: flowId, usedAt: null, deliveryStatus: 'PENDING' },
              data: {
                deliveryStatus: 'QUEUE_FAILED',
                deliveryErrorCode: 'EMAIL_QUEUE_ERROR',
              },
            });
            await captureDeliveryFailure('queue', 'EMAIL_QUEUE_ERROR');
          }
          structuredLog({
            event: 'email_queue',
            outcome: recoveryEnvelope ? 'pending_recovery' : 'failed',
            requestId: reqContext.requestId,
            correlationId: flowId,
            errorCode: 'EMAIL_QUEUE_ERROR',
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      } else if (hasCapability('canSendSyncEmail')) {
        const sendClaim = await db.passwordResetToken.updateMany({
          where: {
            id: flowId,
            usedAt: null,
            expiresAt: { gt: new Date() },
            deliveryStatus: 'PENDING',
          },
          data: {
            deliveryStatus: 'SENDING',
            deliveryAttempts: { increment: 1 },
            lastDeliveryAttemptAt: new Date(),
          },
        });
        if (sendClaim.count !== 1) {
          structuredLog({
            event: 'provider_submission',
            outcome: 'skipped_superseded_flow',
            requestId: reqContext.requestId,
            correlationId: flowId,
          });
          return neutralResponse(startedAt);
        }

        let result;
        try {
          result = await providers.email.sendEmail({
            to: deliveryUser.email,
            subject: `Reset your ${orgName} password`,
            html: `<p>Hi ${deliveryUser.firstName || 'User'},</p><p>Click <a href="${resetUrl}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p><p>If you didn't request this, please ignore this email.</p>`,
            text: `Hi ${deliveryUser.firstName || 'User'},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
            from: senderFrom,
            fromName: senderName,
            operationId: flowId,
            sensitiveContent: true,
          });
        } catch (error) {
          const deliveryError = normalizeEmailError(error, 'unknown');
          await db.passwordResetToken.updateMany({
            where: { id: flowId, usedAt: null },
            data: {
              deliveryStatus: deliveryError.retryable ? 'ACCEPTANCE_UNKNOWN' : 'FAILED_PERMANENT',
              deliveryErrorCode: deliveryError.code,
            },
          });
          if (recoveryEnvelope) {
            await db.passwordResetRecovery.updateMany({
              where: { flowId, wipedAt: null },
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
          structuredLog({
            event: 'provider_submission',
            outcome: 'failed',
            requestId: reqContext.requestId,
            correlationId: flowId,
            errorCode: deliveryError.code,
            retryable: deliveryError.retryable,
          });
          await captureDeliveryFailure(
            'provider_submission',
            deliveryError.code,
            deliveryError.retryable
          );
          return neutralResponse(startedAt);
        }

        // The provider has accepted this submission. Persisting the lifecycle
        // marker is diagnostic bookkeeping and must never turn an accepted
        // email into a reported failure or cause a duplicate submission.
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            component: 'forgot-password',
            event: 'provider_submission',
            outcome: 'accepted',
            requestId: reqContext.requestId,
            correlationId: flowId,
            providerMessageId: result.messageId,
          })
        );
        try {
          await db.$transaction(async (tx) => {
            await tx.passwordResetToken.updateMany({
              where: { id: flowId },
              data: {
                deliveryStatus: 'PROVIDER_ACCEPTED',
                provider: 'configured',
                providerOperationId: flowId,
                providerMessageId: result.messageId,
                providerAcceptedAt: new Date(),
                deliveryErrorCode: null,
              },
            });
            await tx.passwordResetRecovery.updateMany({
              where: { flowId, wipedAt: null },
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
            for (const organizationId of organizationIds) {
              await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
              await createSecurityAuditEvent(tx, {
                organizationId,
                eventType: 'USER_PASSWORD_RESET',
                actorType: 'SYSTEM',
                requestId: reqContext.requestId,
                correlationId: flowId,
                idempotencyKey: `password-reset-${flowId}-accepted-${organizationId}`,
                description: 'Password reset email was accepted by the provider',
                metadata: {
                  outcome: 'accepted',
                  stage: 'provider_submission',
                  targetUserId: deliveryUser.id,
                  provider: 'configured',
                  providerOperationId: flowId,
                  providerMessageId: result.messageId,
                },
              });
            }
          });
        } catch (lifecycleError) {
          structuredLog({
            event: 'delivery_lifecycle_update',
            outcome: 'failed_after_provider_acceptance',
            requestId: reqContext.requestId,
            correlationId: flowId,
            providerMessageId: result.messageId,
            errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
          });
        }
      } else {
        await db.passwordResetToken.updateMany({
          where: { id: flowId, usedAt: null },
          data: { deliveryStatus: 'NOT_CONFIGURED', deliveryErrorCode: 'EMAIL_NOT_CONFIGURED' },
        });
        if (recoveryEnvelope) {
          await db.passwordResetRecovery.updateMany({
            where: { flowId, wipedAt: null },
            data: {
              cipherVersion: null,
              keyId: null,
              nonce: null,
              ciphertext: null,
              authTag: null,
              wipedAt: new Date(),
              enqueueStatus: 'NOT_CONFIGURED',
            },
          });
        }
        structuredLog({
          event: 'email_capability',
          outcome: 'unavailable',
          requestId: reqContext.requestId,
          correlationId: flowId,
          errorCode: 'EMAIL_NOT_CONFIGURED',
        });
        await captureDeliveryFailure('configuration', 'EMAIL_NOT_CONFIGURED', false);
      }
    } catch (error) {
      // Once an account has been resolved, all downstream failures keep the
      // public response neutral to prevent status-based enumeration.
      structuredLog({
        event: 'known_account_processing',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    return neutralResponse(startedAt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    structuredLog({
      event: 'request_processing',
      outcome: 'failed',
      requestId: reqContext.requestId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
