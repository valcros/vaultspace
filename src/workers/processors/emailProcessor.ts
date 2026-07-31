/**
 * Email Job Processor
 *
 * Processes email sending jobs using the EmailProvider.
 * Also handles notification jobs for document events.
 */

import { Job, UnrecoverableError } from 'bullmq';

import { bootstrapDb, withOrgContext } from '@/lib/db';
import { captureSecurityAudit, createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { resolvePasswordResetAuditScope } from '@/lib/auth/passwordResetAuditScope';
import { getProviders } from '@/providers';
import { normalizeEmailError } from '@/providers/email/errors';
import { EmailNotificationService } from '@/services/notifications';

import type { EmailSendJobPayload, NotificationJobPayload } from '../types';

// Email templates - simplified for Phase 2
const EMAIL_TEMPLATES: Record<
  string,
  (data: Record<string, unknown>) => { subject: string; html: string; text?: string }
> = {
  'room-invitation': (data) => ({
    subject: `You've been invited to ${data['roomName']}`,
    html: `
      <h1>You've been invited!</h1>
      <p>${data['inviterName']} has invited you to access the data room "${data['roomName']}".</p>
      <p>Click the link below to access the room:</p>
      <a href="${data['roomUrl']}">Access Room</a>
    `,
    text: `You've been invited to ${data['roomName']}. Visit: ${data['roomUrl']}`,
  }),

  'document-shared': (data) => ({
    subject: `${data['sharerName']} shared a document with you`,
    html: `
      <h1>Document Shared</h1>
      <p>${data['sharerName']} has shared "${data['documentName']}" with you.</p>
      <p>Click the link below to view the document:</p>
      <a href="${data['documentUrl']}">View Document</a>
    `,
    text: `${data['sharerName']} shared "${data['documentName']}". View it at: ${data['documentUrl']}`,
  }),

  'password-reset': (data) => ({
    subject: `Reset your ${data['organizationName'] || 'VaultSpace'} password`,
    html: `
      <h1>Password Reset Request</h1>
      <p>Hi ${data['userName'] || 'User'},</p>
      <p>You requested to reset your password. Click the link below to proceed:</p>
      <a href="${data['resetUrl']}">Reset Password</a>
      <p>This link expires in ${data['expiresIn'] || '1 hour'}.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
    text: `Reset your password at: ${data['resetUrl']}. This link expires in ${
      data['expiresIn'] || '1 hour'
    }.`,
  }),

  'room-digest': (data) => ({
    subject: `${titleCase(String(data['period'] || 'weekly'))} digest: ${data['roomName'] || 'Room'}`,
    html: buildRoomDigestEmail(data),
    text: buildRoomDigestText(data),
  }),

  welcome: (data) => ({
    subject: 'Welcome to VaultSpace',
    html: `
      <h1>Welcome to VaultSpace!</h1>
      <p>Hi ${data['userName']},</p>
      <p>Your account has been created successfully.</p>
      <p>Get started by exploring your dashboard:</p>
      <a href="${data['dashboardUrl']}">Go to Dashboard</a>
    `,
    text: `Welcome to VaultSpace, ${data['userName']}! Visit your dashboard: ${data['dashboardUrl']}`,
  }),
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function buildRoomDigestEmail(data: Record<string, unknown>): string {
  const summary = asRecord(data['summary']);
  const topDocuments = asRecordArray(data['topDocuments']);
  const recentQuestions = asRecordArray(data['recentQuestions']);
  const viewerActivity = asRecordArray(data['viewerActivity']);
  const roomUrl = escapeHtml(data['roomUrl']);

  const statRows = [
    ['Documents uploaded', summary['documentsUploaded']],
    ['Documents viewed', summary['documentsViewed']],
    ['Documents downloaded', summary['documentsDownloaded']],
    ['Unique viewers', summary['uniqueViewers']],
    ['Questions submitted', summary['questionsSubmitted']],
    ['Questions answered', summary['questionsAnswered']],
    ['New share links', summary['newShareLinks']],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 6px 0; color: #475569;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(
          value ?? 0
        )}</td></tr>`
    )
    .join('');

  const topDocumentRows =
    topDocuments.length > 0
      ? topDocuments
          .map(
            (doc) =>
              `<li>${escapeHtml(doc['name'])}: ${escapeHtml(doc['views'] ?? 0)} views, ${escapeHtml(
                doc['downloads'] ?? 0
              )} downloads</li>`
          )
          .join('')
      : '<li>No document views or downloads in this period.</li>';

  const questionRows =
    recentQuestions.length > 0
      ? recentQuestions
          .map(
            (question) =>
              `<li>${escapeHtml(question['subject'])} (${escapeHtml(question['status'])})</li>`
          )
          .join('')
      : '<li>No questions in this period.</li>';

  const viewerRows =
    viewerActivity.length > 0
      ? viewerActivity
          .slice(0, 10)
          .map(
            (viewer) =>
              `<li>${escapeHtml(viewer['email'])}: ${escapeHtml(viewer['views'] ?? 0)} sessions</li>`
          )
          .join('')
      : '<li>No viewer sessions in this period.</li>';

  return [
    '<div style="font-family: sans-serif; max-width: 640px; margin: 0 auto;">',
    `<h2 style="color: #1e293b;">${titleCase(String(data['period'] || 'weekly'))} Room Digest</h2>`,
    `<p>Hello ${escapeHtml(data['recipientName'] || 'Admin')},</p>`,
    `<p>Activity summary for <strong>${escapeHtml(data['roomName'])}</strong>.</p>`,
    `<p style="color: #64748b;">${escapeHtml(data['from'])} through ${escapeHtml(data['to'])}</p>`,
    '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">',
    statRows,
    '</table>',
    '<h3 style="color: #334155;">Top documents</h3>',
    `<ul>${topDocumentRows}</ul>`,
    '<h3 style="color: #334155;">Recent questions</h3>',
    `<ul>${questionRows}</ul>`,
    '<h3 style="color: #334155;">Viewer activity</h3>',
    `<ul>${viewerRows}</ul>`,
    roomUrl
      ? `<p><a href="${roomUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open Room</a></p>`
      : '',
    '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
    '<p style="color: #64748b; font-size: 12px;">Manage notification preferences in account settings.</p>',
    '</div>',
  ].join('\n');
}

function buildRoomDigestText(data: Record<string, unknown>): string {
  const summary = asRecord(data['summary']);
  return [
    `${titleCase(String(data['period'] || 'weekly'))} digest: ${data['roomName'] || 'Room'}`,
    `${data['from'] || ''} through ${data['to'] || ''}`,
    `Documents uploaded: ${summary['documentsUploaded'] ?? 0}`,
    `Documents viewed: ${summary['documentsViewed'] ?? 0}`,
    `Documents downloaded: ${summary['documentsDownloaded'] ?? 0}`,
    `Unique viewers: ${summary['uniqueViewers'] ?? 0}`,
    `Questions submitted: ${summary['questionsSubmitted'] ?? 0}`,
    `Questions answered: ${summary['questionsAnswered'] ?? 0}`,
    `New share links: ${summary['newShareLinks'] ?? 0}`,
    data['roomUrl'] ? `Open room: ${data['roomUrl']}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function processEmailJob(job: Job<EmailSendJobPayload>): Promise<void> {
  const { to, subject, template, data, from, fromName, passwordReset } = job.data;
  const attempt = (job.attemptsMade ?? 0) + 1;
  const maxAttempts = job.opts?.attempts ?? 1;

  console.log(
    JSON.stringify({
      component: 'email-worker',
      event: 'provider_submission_started',
      outcome: 'started',
      template,
      jobId: job.id ?? null,
      correlationId: passwordReset?.flowId ?? null,
      attempt,
      maxAttempts,
      recipientCount: Array.isArray(to) ? to.length : 1,
    })
  );

  const providers = getProviders();
  const provider = providers.email.providerName;
  let resetAuditScope: Awaited<ReturnType<typeof resolvePasswordResetAuditScope>> | null = null;
  let resetAuditSource: {
    userId: string;
    requestId: string | null;
    organizationId: string | null;
    auditOrganizationIds: string[];
  } | null = null;

  if (passwordReset) {
    const now = new Date();
    const claim = await bootstrapDb.passwordResetToken.updateMany({
      where: {
        id: passwordReset.flowId,
        usedAt: null,
        expiresAt: { gt: now },
        deliveryStatus: { in: ['PENDING', 'QUEUED', 'FAILED_RETRYING', 'SENDING'] },
        deliveryAttempts: { lt: attempt },
        OR: [{ provider: null }, { provider }],
      },
      data: {
        deliveryStatus: 'SENDING',
        deliveryAttempts: attempt,
        lastDeliveryAttemptAt: now,
        deliveryErrorCode: null,
        provider,
        providerOperationId: passwordReset.flowId,
      },
    });

    if (claim.count !== 1) {
      const existing = await bootstrapDb.passwordResetToken.findUnique({
        where: { id: passwordReset.flowId },
        select: {
          userId: true,
          requestId: true,
          organizationId: true,
          auditOrganizationIds: true,
          provider: true,
          providerOperationId: true,
          deliveryStatus: true,
          deliveryAttempts: true,
          usedAt: true,
          expiresAt: true,
        },
      });

      if (
        existing?.provider &&
        existing.provider !== provider &&
        !existing.usedAt &&
        existing.expiresAt > now &&
        existing.deliveryAttempts < attempt &&
        ['PENDING', 'QUEUED', 'FAILED_RETRYING', 'SENDING'].includes(existing.deliveryStatus)
      ) {
        const blockedStatus =
          existing.deliveryStatus === 'SENDING'
            ? 'ACCEPTANCE_UNKNOWN'
            : 'PROVIDER_CONFIGURATION_MISMATCH';
        const transitioned = await bootstrapDb.$transaction(async (tx) => {
          const transition = await tx.passwordResetToken.updateMany({
            where: {
              id: passwordReset.flowId,
              provider: existing.provider,
              usedAt: null,
              expiresAt: { gt: now },
              deliveryStatus: existing.deliveryStatus,
              deliveryAttempts: existing.deliveryAttempts,
            },
            data: {
              deliveryStatus: blockedStatus,
              deliveryErrorCode: 'PROVIDER_CHANGED_DURING_RETRY',
              lastDeliveryAttemptAt: now,
            },
          });
          if (transition.count !== 1) {
            return false;
          }
          const auditScope = await resolvePasswordResetAuditScope(tx, existing, {
            allowLegacyCurrentMembershipFallback: true,
          });
          for (const organizationId of auditScope.organizationIds) {
            await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
            await createSecurityAuditEvent(tx, {
              organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'SYSTEM',
              requestId: existing.requestId ?? passwordReset.requestId,
              correlationId: passwordReset.flowId,
              idempotencyKey: `password-reset-${passwordReset.flowId}-provider-mismatch-${attempt}-${organizationId}`,
              description: 'Password reset email retry was blocked after the provider changed',
              metadata: {
                outcome: 'blocked',
                stage: 'provider_submission',
                targetUserId: existing.userId,
                auditScopeSource: auditScope.source,
                previousProvider: existing.provider,
                configuredProvider: provider,
                providerOperationId: existing.providerOperationId,
                attempt,
                errorCode: 'PROVIDER_CHANGED_DURING_RETRY',
              },
            });
          }
          return true;
        });
        console.error(
          JSON.stringify({
            component: 'email-worker',
            event: 'provider_submission_skipped',
            outcome: transitioned ? 'blocked' : 'conflict',
            reason: 'PROVIDER_CHANGED_DURING_RETRY',
            jobId: job.id ?? null,
            correlationId: passwordReset.flowId,
            previousProvider: existing.provider,
            configuredProvider: provider,
            attempt,
          })
        );
        return;
      }
      const reason = !existing
        ? 'FLOW_NOT_FOUND'
        : existing.usedAt
          ? 'FLOW_ALREADY_USED'
          : existing.expiresAt <= now
            ? 'FLOW_EXPIRED'
            : existing.deliveryStatus === 'PROVIDER_ACCEPTED'
              ? 'ALREADY_ACCEPTED'
              : existing.deliveryAttempts >= attempt
                ? 'ATTEMPT_ALREADY_CLAIMED'
                : 'FLOW_NOT_CLAIMABLE';

      console.log(
        JSON.stringify({
          component: 'email-worker',
          event: 'provider_submission_skipped',
          outcome: 'skipped',
          reason,
          jobId: job.id ?? null,
          correlationId: passwordReset.flowId,
          attempt,
        })
      );
      return;
    }

    resetAuditSource = await bootstrapDb.passwordResetToken.findUnique({
      where: { id: passwordReset.flowId },
      select: {
        userId: true,
        requestId: true,
        organizationId: true,
        auditOrganizationIds: true,
      },
    });
    if (!resetAuditSource) {
      throw new Error('Claimed password reset flow could not be reloaded');
    }
    resetAuditScope = await resolvePasswordResetAuditScope(bootstrapDb, resetAuditSource, {
      allowLegacyCurrentMembershipFallback: true,
    });
    if (resetAuditScope.organizationIds.length === 0) {
      console.error(
        JSON.stringify({
          component: 'email-worker',
          event: 'password_reset_audit_scope',
          outcome: 'unavailable',
          jobId: job.id ?? null,
          correlationId: passwordReset.flowId,
          attempt,
        })
      );
    }
  }

  let emailSubject = subject;
  let emailHtml = '';
  let emailText: string | undefined;

  // Use template if provided
  if (template && EMAIL_TEMPLATES[template]) {
    const rendered = EMAIL_TEMPLATES[template](data);
    emailSubject = rendered.subject;
    emailHtml = rendered.html;
    emailText = rendered.text;
  } else {
    // Fallback to raw HTML from data
    emailHtml = (data['html'] as string) || '';
    emailText = (data['text'] as string) || undefined;
  }

  let result: { messageId: string };
  try {
    result = await providers.email.sendEmail({
      to,
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
      // Per-org sender identity (when the enqueuer resolved one); else default.
      from,
      fromName,
      operationId: passwordReset?.flowId,
      sensitiveContent: template === 'password-reset',
    });
  } catch (error) {
    const deliveryError = normalizeEmailError(error, provider);
    const exhausted = attempt >= maxAttempts;
    const terminal = !deliveryError.retryable || exhausted;
    let lifecycleTransitioned = !passwordReset;

    if (passwordReset) {
      try {
        const transition = await bootstrapDb.passwordResetToken.updateMany({
          where: {
            id: passwordReset.flowId,
            usedAt: null,
            deliveryStatus: 'SENDING',
            deliveryAttempts: attempt,
          },
          data: {
            deliveryStatus: terminal
              ? deliveryError.retryable
                ? 'FAILED_EXHAUSTED'
                : 'FAILED_PERMANENT'
              : 'FAILED_RETRYING',
            deliveryErrorCode: deliveryError.code,
            lastDeliveryAttemptAt: new Date(),
          },
        });
        lifecycleTransitioned = transition.count === 1;
      } catch (lifecycleError) {
        console.error(
          JSON.stringify({
            component: 'email-worker',
            event: 'delivery_lifecycle_update',
            outcome: 'failed',
            jobId: job.id ?? null,
            correlationId: passwordReset.flowId,
            errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
          })
        );
      }

      if (terminal && lifecycleTransitioned) {
        await Promise.all(
          (resetAuditScope?.organizationIds ?? []).map((organizationId) =>
            captureSecurityAudit({
              organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: 'SYSTEM',
              requestId: passwordReset.requestId,
              correlationId: passwordReset.flowId,
              description: 'Password reset email could not be submitted to the provider',
              metadata: {
                outcome: 'failure',
                stage: 'provider_submission',
                targetUserId: resetAuditSource?.userId ?? passwordReset.userId,
                auditScopeSource: resetAuditScope?.source ?? 'unavailable',
                jobId: job.id ?? null,
                attempt,
                maxAttempts,
                provider,
                errorCode: deliveryError.code,
                retryable: deliveryError.retryable,
              },
            })
          )
        );
      }
    }

    console.error(
      JSON.stringify({
        component: 'email-worker',
        event: 'provider_submission_failed',
        outcome: terminal ? 'failed' : 'retrying',
        template,
        jobId: job.id ?? null,
        correlationId: passwordReset?.flowId ?? null,
        attempt,
        maxAttempts,
        errorCode: deliveryError.code,
        provider: deliveryError.provider,
        retryable: deliveryError.retryable,
      })
    );

    if (!deliveryError.retryable) {
      throw new UnrecoverableError(deliveryError.code);
    }
    throw deliveryError;
  }

  // The provider has returned acceptance. Log it before lifecycle persistence
  // so a database failure cannot erase the provider message correlation. Do not
  // retry a successfully submitted email solely because this later write fails.
  console.log(
    JSON.stringify({
      component: 'email-worker',
      event: 'provider_submission_accepted',
      outcome: 'accepted',
      template,
      jobId: job.id ?? null,
      correlationId: passwordReset?.flowId ?? null,
      providerMessageId: result.messageId,
      attempt,
    })
  );

  if (passwordReset) {
    try {
      const transitioned = await bootstrapDb.$transaction(async (tx) => {
        const transition = await tx.passwordResetToken.updateMany({
          where: {
            id: passwordReset.flowId,
            usedAt: null,
            deliveryStatus: 'SENDING',
            deliveryAttempts: attempt,
          },
          data: {
            deliveryStatus: 'PROVIDER_ACCEPTED',
            provider,
            providerOperationId: passwordReset.flowId,
            providerMessageId: result.messageId,
            providerAcceptedAt: new Date(),
            deliveryErrorCode: null,
            lastDeliveryAttemptAt: new Date(),
          },
        });
        if (transition.count !== 1) {
          return false;
        }
        for (const organizationId of resetAuditScope?.organizationIds ?? []) {
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
          await createSecurityAuditEvent(tx, {
            organizationId,
            eventType: 'USER_PASSWORD_RESET',
            actorType: 'SYSTEM',
            requestId: resetAuditSource?.requestId ?? passwordReset.requestId,
            correlationId: passwordReset.flowId,
            idempotencyKey: `password-reset-${passwordReset.flowId}-accepted-${organizationId}`,
            description: 'Password reset email was accepted by the provider',
            metadata: {
              outcome: 'accepted',
              stage: 'provider_submission',
              targetUserId: resetAuditSource?.userId ?? passwordReset.userId,
              auditScopeSource: resetAuditScope?.source ?? 'unavailable',
              jobId: job.id ?? null,
              attempt,
              provider,
              providerMessageId: result.messageId,
            },
          });
        }
        return true;
      });
      if (!transitioned) {
        console.error(
          JSON.stringify({
            component: 'email-worker',
            event: 'delivery_lifecycle_update',
            outcome: 'skipped',
            reason: 'FLOW_CHANGED_AFTER_PROVIDER_ACCEPTANCE',
            jobId: job.id ?? null,
            correlationId: passwordReset.flowId,
            providerMessageId: result.messageId,
            attempt,
          })
        );
      }
    } catch (lifecycleError) {
      console.error(
        JSON.stringify({
          component: 'email-worker',
          event: 'delivery_lifecycle_update',
          outcome: 'failed_after_provider_acceptance',
          jobId: job.id ?? null,
          correlationId: passwordReset.flowId,
          providerMessageId: result.messageId,
          attempt,
          errorName: lifecycleError instanceof Error ? lifecycleError.name : 'UnknownError',
        })
      );
    }
  }
}

/**
 * Create notification service instance
 */
function createNotificationService(): EmailNotificationService {
  const providers = getProviders();
  const appUrl = process.env['APP_URL'];
  if (!appUrl) {
    throw new Error('[EmailProcessor] APP_URL environment variable is required');
  }
  return new EmailNotificationService({
    emailProvider: providers.email,
    fromAddress: process.env['SMTP_FROM'] || 'noreply@vaultspace.local',
    appUrl,
  });
}

/**
 * Process document uploaded notification job
 */
export async function processDocumentUploadedNotification(
  job: Job<NotificationJobPayload>
): Promise<void> {
  const { organizationId, roomId, documentId, uploaderId } = job.data;
  console.log(`[EmailProcessor] Processing document upload notification for ${documentId}`);

  const notificationService = createNotificationService();
  await notificationService.notifyDocumentUploaded({
    organizationId,
    roomId,
    documentId,
    uploaderId,
  });

  console.log(`[EmailProcessor] Document upload notification sent for ${documentId}`);
}

/**
 * Process document viewed notification job
 */
export async function processDocumentViewedNotification(
  job: Job<NotificationJobPayload>
): Promise<void> {
  const { organizationId, roomId, documentId, viewerEmail, incrementViewCount } = job.data;
  console.log(`[EmailProcessor] Processing document view notification for ${documentId}`);

  // View counting lives in the job path so the request path never holds a
  // hot-row UPDATE lock. Semantics: one increment per preview request (the
  // preview route enqueues exactly one job per request with this flag set).
  // This is idempotent-enough for an analytics counter: a BullMQ redelivery
  // after a partial failure may double-count a view, which is acceptable.
  if (incrementViewCount) {
    await withOrgContext(organizationId, (tx) =>
      tx.document.updateMany({
        where: { id: documentId, organizationId },
        data: { viewCount: { increment: 1 } },
      })
    );
  }

  const notificationService = createNotificationService();
  await notificationService.notifyDocumentViewed({
    organizationId,
    roomId,
    documentId,
    viewerEmail,
  });

  console.log(`[EmailProcessor] Document view notification sent for ${documentId}`);
}
