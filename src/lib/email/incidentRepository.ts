import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import type { IncidentEvidence } from './incidentEvidence';

export interface IncidentInsertResult {
  inserted: number;
  duplicate: number;
}

function sameEvidence(stored: IncidentEvidence, incoming: IncidentEvidence): boolean {
  return (
    stored.provider === incoming.provider &&
    stored.providerMessageId === incoming.providerMessageId &&
    stored.recipientFingerprint === incoming.recipientFingerprint &&
    stored.recipientFingerprintKeyId === incoming.recipientFingerprintKeyId &&
    stored.recipientDomain === incoming.recipientDomain &&
    stored.status === incoming.status &&
    stored.failureReason === incoming.failureReason &&
    stored.smtpStatusCode === incoming.smtpStatusCode &&
    stored.enhancedSmtpStatusCode === incoming.enhancedSmtpStatusCode &&
    stored.recipientMailServer === incoming.recipientMailServer &&
    stored.eventAt.getTime() === incoming.eventAt.getTime()
  );
}

/** The collector role needs SELECT and INSERT on this table only. */
export async function insertIncidentEvidence(
  client: Pick<PrismaClient, 'emailDeliveryIncident'>,
  evidence: IncidentEvidence[]
): Promise<IncidentInsertResult> {
  let inserted = 0;
  let duplicate = 0;
  for (const item of evidence) {
    const result = await client.emailDeliveryIncident.createMany({
      data: { id: randomUUID(), ...item },
      skipDuplicates: true,
    });
    if (result.count === 1) {
      inserted++;
      continue;
    }
    const stored = await client.emailDeliveryIncident.findUnique({
      where: {
        provider_providerMessageId_recipientFingerprint: {
          provider: item.provider,
          providerMessageId: item.providerMessageId,
          recipientFingerprint: item.recipientFingerprint,
        },
      },
    });
    if (!stored || !sameEvidence(stored, item)) {
      throw new Error('EMAIL_INCIDENT_EVIDENCE_CONFLICT');
    }
    duplicate++;
  }
  return { inserted, duplicate };
}

export function createIncidentCollectorClient(): PrismaClient {
  const url = process.env['EMAIL_INCIDENT_DATABASE_URL'];
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
    throw new Error('EMAIL_INCIDENT_DATABASE_CONFIGURATION_INVALID');
  }
  return new PrismaClient({
    log: [],
    datasources: { db: { url } },
  });
}
