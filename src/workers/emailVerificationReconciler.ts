/**
 * Re-enqueues durable verification flows after a web/Redis crash boundary.
 * PostgreSQL is authoritative; jobs remain flow-only and idempotently named.
 */

import { bootstrapDb } from '@/lib/db';
import { enqueueEmailVerificationDelivery } from '@/lib/auth/emailVerificationDeliveryFlow';
import { getEmailVerificationDeliveryMode } from '@/lib/auth/emailVerificationDeliveryContract';

const BATCH_SIZE = 50;

export async function reconcileEmailVerificationDeliveries(): Promise<{
  scanned: number;
  enqueued: number;
  expired: number;
}> {
  if (getEmailVerificationDeliveryMode() !== 'durable') {
    return { scanned: 0, enqueued: 0, expired: 0 };
  }
  const now = new Date();
  // A worker can disappear after claiming a flow and before completing its
  // terminal write. Never resend this ambiguous attempt; mark it explicitly
  // and wipe its bearer envelope. An operator can investigate by flow ID.
  const staleClaims = await bootstrapDb.emailVerificationToken.findMany({
    where: {
      deliveryContractVersion: 1,
      usedAt: null,
      providerAcceptedAt: null,
      deliveryStatus: 'SENDING',
      recovery: { is: { wipedAt: null, sendLeaseExpiresAt: { lte: now } } },
    },
    select: { id: true },
    take: BATCH_SIZE,
  });
  for (const flow of staleClaims) {
    await bootstrapDb.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { id: flow.id, deliveryStatus: 'SENDING', providerAcceptedAt: null },
        data: {
          deliveryStatus: 'ACCEPTANCE_UNKNOWN',
          deliveryErrorCode: 'EMAIL_VERIFICATION_SEND_LEASE_EXPIRED',
        },
      });
      await tx.emailVerificationRecovery.updateMany({
        where: { flowId: flow.id, wipedAt: null, sendLeaseExpiresAt: { lte: now } },
        data: {
          wipedAt: now,
          nonce: null,
          ciphertext: null,
          authTag: null,
          keyId: null,
          sendLeaseId: null,
          sendLeaseExpiresAt: null,
        },
      });
    });
  }
  const expired = await bootstrapDb.emailVerificationToken.updateMany({
    where: {
      deliveryContractVersion: 1,
      usedAt: null,
      expiresAt: { lte: now },
      deliveryStatus: { in: ['PENDING', 'QUEUED', 'QUEUE_RETRYING', 'FAILED_RETRYING'] },
    },
    data: { deliveryStatus: 'EXPIRED', deliveryErrorCode: 'EMAIL_VERIFICATION_TOKEN_EXPIRED' },
  });
  await bootstrapDb.emailVerificationRecovery.updateMany({
    where: {
      token: { deliveryContractVersion: 1, expiresAt: { lte: now }, usedAt: null },
      wipedAt: null,
    },
    data: { wipedAt: now, nonce: null, ciphertext: null, authTag: null, keyId: null },
  });
  // Verification can succeed before a queued worker starts. The verification
  // endpoint performs this wipe synchronously; this is the durable backstop.
  await bootstrapDb.emailVerificationRecovery.updateMany({
    where: { token: { deliveryContractVersion: 1, usedAt: { not: null } }, wipedAt: null },
    data: {
      wipedAt: now,
      nonce: null,
      ciphertext: null,
      authTag: null,
      keyId: null,
      sendLeaseId: null,
      sendLeaseExpiresAt: null,
    },
  });

  const flows = await bootstrapDb.emailVerificationToken.findMany({
    where: {
      deliveryContractVersion: 1,
      usedAt: null,
      expiresAt: { gt: now },
      providerAcceptedAt: null,
      deliveryStatus: { in: ['PENDING', 'QUEUE_RETRYING', 'FAILED_RETRYING'] },
      recovery: { is: { wipedAt: null, nextEnqueueAt: { lte: now } } },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });
  for (const flow of flows) {
    await enqueueEmailVerificationDelivery(flow.id);
  }
  return { scanned: flows.length, enqueued: flows.length, expired: expired.count };
}

async function main() {
  try {
    const summary = await reconcileEmailVerificationDeliveries();
    console.log(
      JSON.stringify({
        component: 'email-verification-reconciler',
        event: 'run',
        outcome: 'completed',
        ...summary,
      })
    );
  } catch {
    console.error(
      JSON.stringify({
        component: 'email-verification-reconciler',
        event: 'run',
        outcome: 'failed',
        errorCode: 'EMAIL_VERIFICATION_RECONCILER_FAILED',
      })
    );
    process.exitCode = 1;
  } finally {
    await bootstrapDb.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
