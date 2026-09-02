import { randomUUID } from 'crypto';
import { Job, UnrecoverableError } from 'bullmq';

import { bootstrapDb } from '@/lib/db';
import { buildEmailVerificationUrl } from '@/lib/auth/emailVerificationDelivery';
import {
  decryptEmailVerificationRecoveryToken,
  EmailVerificationDeliveryContractError,
} from '@/lib/auth/emailVerificationDeliveryContract';
import { getConfiguredEmailProviderName, getProviders } from '@/providers';
import { normalizeEmailError, type EmailProviderName } from '@/providers/email/errors';

import type { EmailVerificationDeliveryJobPayload } from '../types';

const SEND_LEASE_MS = 2 * 60 * 1000;

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: 'email-verification-delivery', ...fields }));
}

/**
 * Claims and submits a verification email. The queue receives only the flow
 * identifier; recipient identity and bearer token are decrypted only here.
 */
export async function processEmailVerificationDeliveryJob(
  job: Job<EmailVerificationDeliveryJobPayload>
): Promise<void> {
  if (job.data.schemaVersion !== 1 || !job.data.flowId) {
    throw new UnrecoverableError('EMAIL_VERIFICATION_JOB_INVALID');
  }
  const attempt = (job.attemptsMade ?? 0) + 1;
  const leaseId = randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + SEND_LEASE_MS);

  const claim = await bootstrapDb.$transaction(async (tx) => {
    const flow = await tx.emailVerificationToken.findUnique({
      where: { id: job.data.flowId },
      include: { recovery: true },
    });
    if (
      !flow ||
      flow.deliveryContractVersion !== 1 ||
      flow.usedAt ||
      flow.expiresAt <= now ||
      flow.providerAcceptedAt ||
      flow.deliveryStatus === 'ACCEPTANCE_UNKNOWN' ||
      !flow.recovery ||
      flow.recovery.wipedAt ||
      !flow.recovery.nonce ||
      !flow.recovery.ciphertext ||
      !flow.recovery.authTag ||
      !flow.recovery.keyId ||
      (flow.recovery.sendLeaseExpiresAt && flow.recovery.sendLeaseExpiresAt > now)
    ) {
      return null;
    }
    const user = await tx.user.findUnique({
      where: { id: flow.userId },
      select: { email: true, firstName: true, isActive: true, emailVerifiedAt: true },
    });
    if (!user || !user.isActive || user.emailVerifiedAt) {
      return null;
    }
    const updated = await tx.emailVerificationToken.updateMany({
      where: {
        id: flow.id,
        usedAt: null,
        expiresAt: { gt: now },
        providerAcceptedAt: null,
        deliveryStatus: { in: ['PENDING', 'QUEUED', 'QUEUE_RETRYING', 'FAILED_RETRYING'] },
      },
      data: {
        deliveryStatus: 'SENDING',
        deliveryAttempts: attempt,
        lastDeliveryAttemptAt: now,
        deliveryErrorCode: null,
      },
    });
    if (updated.count !== 1) {
      return null;
    }
    const recoveryClaim = await tx.emailVerificationRecovery.updateMany({
      where: { flowId: flow.id, wipedAt: null },
      data: {
        sendLeaseId: leaseId,
        sendLeaseExpiresAt: leaseUntil,
        sendFence: { increment: 1 },
        deliveryAttempt: attempt,
      },
    });
    if (recoveryClaim.count !== 1) {
      return null;
    }
    // Read the persisted value rather than deriving it from the earlier
    // snapshot. The fence is an optimistic-concurrency boundary for the
    // terminal acceptance write below.
    const claimedRecovery = await tx.emailVerificationRecovery.findUnique({
      where: { flowId: flow.id },
      select: { sendFence: true },
    });
    if (!claimedRecovery) {
      return null;
    }
    return { flow, user, sendFence: claimedRecovery.sendFence };
  });

  if (!claim) {
    log({
      event: 'submission_skipped',
      outcome: 'not_claimable',
      flowId: job.data.flowId,
      attempt,
    });
    return;
  }

  let publicToken: string;
  try {
    publicToken = decryptEmailVerificationRecoveryToken(
      {
        keyId: claim.flow.recovery!.keyId!,
        nonce: claim.flow.recovery!.nonce!,
        ciphertext: claim.flow.recovery!.ciphertext!,
        authTag: claim.flow.recovery!.authTag!,
        recipientFingerprint: claim.flow.recovery!.recipientFingerprint,
      },
      claim.user.email,
      { flowId: claim.flow.id, storedToken: claim.flow.token, expiresAt: claim.flow.expiresAt }
    );
  } catch (error) {
    const code =
      error instanceof EmailVerificationDeliveryContractError
        ? error.code
        : 'EMAIL_VERIFICATION_RECOVERY_DECRYPT_FAILED';
    await bootstrapDb.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { id: claim.flow.id, deliveryStatus: 'SENDING' },
        data: { deliveryStatus: 'FAILED_PERMANENT', deliveryErrorCode: code },
      });
      await tx.emailVerificationRecovery.updateMany({
        where: { flowId: claim.flow.id, sendLeaseId: leaseId },
        data: {
          wipedAt: new Date(),
          nonce: null,
          ciphertext: null,
          authTag: null,
          keyId: null,
          sendLeaseId: null,
          sendLeaseExpiresAt: null,
        },
      });
    });
    log({
      event: 'submission_failed',
      outcome: 'blocked',
      flowId: claim.flow.id,
      attempt,
      errorCode: code,
    });
    throw new UnrecoverableError(code);
  }

  let providerName: EmailProviderName = 'unknown';
  let providerSubmitted = false;
  try {
    // URL construction is configuration-sensitive. Keep it within the same
    // terminal failure path as provider submission so a malformed APP_URL
    // cannot strand a SENDING lease until the reconciler intervenes.
    const verifyUrl = buildEmailVerificationUrl(publicToken);
    const safeName = claim.user.firstName.replace(
      /[&<>"']/g,
      (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!
    );
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto"><h2>Verify your email</h2><p>Hi ${safeName || 'there'}, please confirm your email address to finish setting up your VaultSpace account.</p><p><a href="${verifyUrl}">Verify email</a></p><p>This link expires in 24 hours. If you did not create a VaultSpace account, you can ignore this email.</p></div>`;
    const provider = getProviders().email;
    providerName = provider.providerName;
    const result = await provider.sendEmail({
      to: claim.user.email,
      subject: 'Verify your email for VaultSpace',
      html,
      sensitiveContent: true,
      operationId: claim.flow.id,
    });
    providerSubmitted = true;
    await bootstrapDb.$transaction(async (tx) => {
      const acceptance = await tx.emailVerificationToken.updateMany({
        where: {
          id: claim.flow.id,
          deliveryStatus: 'SENDING',
          providerAcceptedAt: null,
          recovery: { is: { sendLeaseId: leaseId, sendFence: claim.sendFence, wipedAt: null } },
        },
        data: {
          deliveryStatus: 'PROVIDER_ACCEPTED',
          provider: provider.providerName,
          providerOperationId: claim.flow.id,
          providerMessageId: result.messageId,
          providerAcceptedAt: new Date(),
          deliveryErrorCode: null,
        },
      });
      const wipe = await tx.emailVerificationRecovery.updateMany({
        where: { flowId: claim.flow.id, sendLeaseId: leaseId, sendFence: claim.sendFence },
        data: {
          wipedAt: new Date(),
          nonce: null,
          ciphertext: null,
          authTag: null,
          keyId: null,
          sendLeaseId: null,
          sendLeaseExpiresAt: null,
        },
      });
      if (acceptance.count !== 1 || wipe.count !== 1) {
        throw new Error('EMAIL_VERIFICATION_ACCEPTANCE_PERSISTENCE_CONFLICT');
      }
    });
    log({
      event: 'provider_submission',
      outcome: 'accepted',
      flowId: claim.flow.id,
      attempt,
      provider: providerName,
    });
  } catch (error) {
    // Resolving the configured name does not initialize a provider. It lets
    // configuration errors still produce a category-only, safe audit event.
    if (providerName === 'unknown') {
      try {
        providerName = getConfiguredEmailProviderName();
      } catch {
        // Preserve unknown rather than risking another failure in error handling.
      }
    }
    const normalized = normalizeEmailError(error, providerName);
    // A retryable transport failure can happen after remote acceptance. Treat
    // it as ambiguous, never as an automatic resend signal.
    // Once the provider accepted the request, a later persistence failure is
    // evidence of unknown delivery state, never proof of a permanent reject.
    const status =
      providerSubmitted || normalized.retryable ? 'ACCEPTANCE_UNKNOWN' : 'FAILED_PERMANENT';
    await bootstrapDb.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { id: claim.flow.id, deliveryStatus: 'SENDING' },
        data: {
          deliveryStatus: status,
          deliveryErrorCode: normalized.code,
          provider: providerName,
        },
      });
      await tx.emailVerificationRecovery.updateMany({
        where: { flowId: claim.flow.id, sendLeaseId: leaseId },
        data: {
          wipedAt: new Date(),
          nonce: null,
          ciphertext: null,
          authTag: null,
          keyId: null,
          sendLeaseId: null,
          sendLeaseExpiresAt: null,
        },
      });
    });
    log({
      event: 'provider_submission',
      outcome: status === 'ACCEPTANCE_UNKNOWN' ? 'unknown' : 'rejected',
      flowId: claim.flow.id,
      attempt,
      provider: providerName,
      errorCode: normalized.code,
    });
    throw new UnrecoverableError(normalized.code);
  }
}
