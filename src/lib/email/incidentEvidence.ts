import { createHmac } from 'node:crypto';

import { normalizeAcsDeliveryRow, type EmailDeliveryObservation } from './deliveryDiagnostics';

export interface IncidentEvidence {
  provider: string;
  providerMessageId: string;
  recipientFingerprint: string;
  recipientFingerprintKeyId: string;
  recipientDomain: string;
  status: string;
  failureReason: string;
  smtpStatusCode: string;
  enhancedSmtpStatusCode: string;
  recipientMailServer: string;
  eventAt: Date;
}

interface AcsIncidentRow {
  TimeGenerated?: unknown;
  CorrelationId?: unknown;
  RecipientId?: unknown;
  RecipientDomain?: unknown;
  DeliveryStatus?: unknown;
  FailureReason?: unknown;
  SmtpStatusCode?: unknown;
  EnhancedSmtpStatusCode?: unknown;
  RecipientMailServerHostName?: unknown;
}

export interface RecipientFingerprintKey {
  id: string;
  bytes: Buffer;
}

/** The key stays in memory. Neither the address nor the key enters an incident row. */
export function normalizeAcsIncidentEvidence(
  row: AcsIncidentRow,
  fingerprintKey: RecipientFingerprintKey
): IncidentEvidence {
  const observation: EmailDeliveryObservation | null = normalizeAcsDeliveryRow(row);
  if (!observation) {
    throw new Error('EMAIL_INCIDENT_PROVIDER_ROW_INVALID');
  }
  const recipient = typeof row.RecipientId === 'string' ? row.RecipientId.trim() : '';
  const at = recipient.lastIndexOf('@');
  if (
    at < 1 ||
    at === recipient.length - 1 ||
    recipient.indexOf('@') !== at ||
    recipient.length > 320 ||
    /\s/.test(recipient) ||
    fingerprintKey.bytes.length < 32 ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(fingerprintKey.id)
  ) {
    throw new Error('EMAIL_INCIDENT_RECIPIENT_OR_KEY_INVALID');
  }
  const domain = recipient.slice(at + 1).toLowerCase();
  if (domain !== observation.recipientDomain) {
    throw new Error('EMAIL_INCIDENT_RECIPIENT_DOMAIN_MISMATCH');
  }
  return {
    provider: observation.provider,
    providerMessageId: observation.providerMessageId,
    recipientFingerprint: createHmac('sha256', fingerprintKey.bytes)
      .update(`${recipient.slice(0, at)}@${domain}`, 'utf8')
      .digest('hex'),
    recipientFingerprintKeyId: fingerprintKey.id,
    recipientDomain: observation.recipientDomain,
    status: observation.status,
    failureReason: observation.failureReason,
    smtpStatusCode: observation.smtpStatusCode,
    enhancedSmtpStatusCode: observation.enhancedSmtpStatusCode,
    recipientMailServer: observation.recipientMailServer,
    eventAt: new Date(observation.observedAt),
  };
}

export function loadRecipientFingerprintKey(): RecipientFingerprintKey {
  const id = process.env['EMAIL_INCIDENT_FINGERPRINT_KEY_ID'] ?? '';
  const encoded = process.env['EMAIL_INCIDENT_FINGERPRINT_KEY'] ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('EMAIL_INCIDENT_FINGERPRINT_KEY_CONFIGURATION_INVALID');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 32 || bytes.toString('base64') !== encoded) {
    throw new Error('EMAIL_INCIDENT_FINGERPRINT_KEY_CONFIGURATION_INVALID');
  }
  return { id, bytes };
}
