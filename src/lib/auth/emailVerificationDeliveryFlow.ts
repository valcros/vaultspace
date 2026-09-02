/** Durable issuance and queueing for email-verification delivery. */

import { createEmailVerificationToken } from './emailVerificationToken';
import {
  EMAIL_VERIFICATION_DELIVERY_CONTRACT_VERSION,
  encryptEmailVerificationRecoveryToken,
  getEmailVerificationDeliveryMode,
  validateEmailVerificationDeliveryConfiguration,
} from './emailVerificationDeliveryContract';
import { bootstrapDb } from '@/lib/db';
import { hasCapability } from '@/lib/deployment-capabilities';
import { getProviders } from '@/providers';
import {
  EMAIL_VERIFICATION_DELIVERY_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
  type EmailVerificationDeliveryJobPayload,
} from '@/workers/types';

export interface IssueEmailVerificationDeliveryInput {
  userId: string;
  email: string;
  requestId: string;
  expiresAt: Date;
}

export interface EmailVerificationDeliveryIssueResult {
  mode: 'legacy' | 'durable';
  flowId: string;
  publicToken: string;
}

/**
 * Creates the token and, in durable mode, the encrypted recovery record in one
 * database transaction. The public token never reaches the queue.
 */
export async function issueEmailVerificationDelivery(
  input: IssueEmailVerificationDeliveryInput
): Promise<EmailVerificationDeliveryIssueResult> {
  const { publicToken, storedToken } = createEmailVerificationToken();
  const mode = getEmailVerificationDeliveryMode();

  if (mode === 'legacy') {
    const token = await bootstrapDb.emailVerificationToken.create({
      data: { userId: input.userId, token: storedToken, expiresAt: input.expiresAt },
      select: { id: true },
    });
    return { mode, flowId: token.id, publicToken };
  }

  validateEmailVerificationDeliveryConfiguration();
  if (!hasCapability('canSendAsyncEmail')) {
    throw new Error('EMAIL_VERIFICATION_ASYNC_DELIVERY_UNAVAILABLE');
  }

  const token = await bootstrapDb.$transaction(async (tx) => {
    const flow = await tx.emailVerificationToken.create({
      data: {
        userId: input.userId,
        token: storedToken,
        expiresAt: input.expiresAt,
        requestId: input.requestId,
        deliveryContractVersion: EMAIL_VERIFICATION_DELIVERY_CONTRACT_VERSION,
        deliveryStatus: 'PENDING',
        providerOperationId: '',
      },
      select: { id: true },
    });
    const envelope = encryptEmailVerificationRecoveryToken(publicToken, input.email, {
      flowId: flow.id,
      storedToken,
      expiresAt: input.expiresAt,
    });
    await tx.emailVerificationRecovery.create({
      data: {
        flowId: flow.id,
        userId: input.userId,
        recipientFingerprint: envelope.recipientFingerprint,
        keyId: envelope.keyId,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        authTag: envelope.authTag,
        providerOperationId: flow.id,
      },
    });
    await tx.emailVerificationToken.update({
      where: { id: flow.id },
      data: { providerOperationId: flow.id },
    });
    return flow;
  });

  return { mode, flowId: token.id, publicToken };
}

/** Queue delivery after the token/recovery transaction commits. Failure is durable. */
export async function enqueueEmailVerificationDelivery(flowId: string): Promise<void> {
  if (getEmailVerificationDeliveryMode() !== 'durable') {
    return;
  }

  try {
    const jobId = await getProviders().job.addJob<EmailVerificationDeliveryJobPayload>(
      QUEUE_NAMES.HIGH,
      JOB_NAMES.EMAIL_VERIFICATION_DELIVER,
      { schemaVersion: 1, flowId, deliveryAttempt: 1 },
      { ...EMAIL_VERIFICATION_DELIVERY_JOB_OPTIONS, jobId: `email-verification-${flowId}` }
    );
    await bootstrapDb.emailVerificationToken.updateMany({
      where: { id: flowId, deliveryStatus: 'PENDING' },
      data: { deliveryStatus: 'QUEUED', queueJobId: jobId, deliveryErrorCode: null },
    });
    await bootstrapDb.emailVerificationRecovery.updateMany({
      where: { flowId, enqueueStatus: 'PENDING' },
      data: { enqueueStatus: 'QUEUED', enqueueAttempts: { increment: 1 } },
    });
  } catch {
    await bootstrapDb.emailVerificationToken.updateMany({
      where: { id: flowId, providerAcceptedAt: null },
      data: { deliveryStatus: 'QUEUE_RETRYING', deliveryErrorCode: 'EMAIL_QUEUE_ERROR' },
    });
    await bootstrapDb.emailVerificationRecovery.updateMany({
      where: { flowId, wipedAt: null },
      data: { enqueueStatus: 'QUEUE_RETRYING', nextEnqueueAt: new Date(Date.now() + 60_000) },
    });
    console.error(
      JSON.stringify({
        component: 'email-verification-delivery',
        event: 'enqueue',
        outcome: 'deferred',
        flowId,
        errorCode: 'EMAIL_QUEUE_ERROR',
      })
    );
  }
}
