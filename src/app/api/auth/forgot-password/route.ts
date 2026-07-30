/**
 * Forgot Password API (F004)
 *
 * POST /api/auth/forgot-password - Request password reset
 */

import { createHmac, randomBytes, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { captureSecurityAudit, createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { bootstrapDb as db } from '@/lib/db';
import { hasCapability } from '@/lib/deployment-capabilities';
import { RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters } from '@/lib/middleware';
import { getProviders } from '@/providers';
import { normalizeEmailError } from '@/providers/email/errors';
import { JOB_NAMES, PASSWORD_RESET_EMAIL_JOB_OPTIONS, QUEUE_NAMES } from '@/workers/types';

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
    if (!baseUrl || !fingerprintSecret) {
      structuredLog({
        event: 'configuration_check',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorCode: !baseUrl ? 'APP_URL_MISSING' : 'SESSION_SECRET_MISSING',
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
      const resetToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      const issuance = await db.$transaction(async (tx) => {
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

        await tx.passwordResetToken.updateMany({
          where: { userId: lockedUser.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: lockedUser.id,
            token: resetToken,
            expiresAt,
            requestId: reqContext.requestId,
            organizationId: lockedSenderOrg?.organization.id ?? null,
            deliveryStatus: 'PENDING',
          },
        });

        await Promise.all(
          lockedMemberships.map((membership) =>
            createSecurityAuditEvent(tx, {
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
            })
          )
        );

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
      const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;
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
          const jobId = await providers.job.addJob(
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
          await db.passwordResetToken.updateMany({
            where: { id: flowId, usedAt: null },
            data: { deliveryStatus: 'QUEUE_FAILED', deliveryErrorCode: 'EMAIL_QUEUE_ERROR' },
          });
          structuredLog({
            event: 'email_queue',
            outcome: 'failed',
            requestId: reqContext.requestId,
            correlationId: flowId,
            errorCode: 'EMAIL_QUEUE_ERROR',
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          await captureDeliveryFailure('queue', 'EMAIL_QUEUE_ERROR');
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
              deliveryStatus: deliveryError.retryable ? 'FAILED_EXHAUSTED' : 'FAILED_PERMANENT',
              deliveryErrorCode: deliveryError.code,
            },
          });
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
          await db.passwordResetToken.updateMany({
            where: { id: flowId, usedAt: null },
            data: {
              deliveryStatus: 'PROVIDER_ACCEPTED',
              providerMessageId: result.messageId,
              deliveryErrorCode: null,
            },
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
