/** Provider-neutral delivery evidence shown only to platform operators. */
export interface EmailDeliveryObservation {
  observedAt: string;
  provider: string;
  providerMessageId: string;
  recipientDomain: string;
  status: string;
  failureReason: string;
  smtpStatusCode: string;
  enhancedSmtpStatusCode: string;
  recipientMailServer: string;
  diagnosis: string;
}

interface AcsDeliveryRow {
  TimeGenerated?: unknown;
  CorrelationId?: unknown;
  RecipientDomain?: unknown;
  DeliveryStatus?: unknown;
  FailureReason?: unknown;
  SmtpStatusCode?: unknown;
  EnhancedSmtpStatusCode?: unknown;
  RecipientMailServerHostName?: unknown;
}

const TERMINAL_FAILURES = new Set([
  'Failed',
  'Bounced',
  'Suppressed',
  'Quarantined',
  'FilteredSpam',
]);
const KNOWN_ACS_FAILURE_REASONS = new Set([
  'DeliveryNotAuthorizedMessageRefused',
  'DnsDomainDoesNotExist',
]);

function bounded(value: unknown, length: number): string {
  return typeof value === 'string' ? value.slice(0, length) : '';
}

function dnsName(value: unknown): string {
  const text = bounded(value, 253).toLowerCase();
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(text) ? text : '';
}

/** Explanations must not claim a private recipient-side rule was identified. */
export function diagnoseDelivery(
  observation: Pick<
    EmailDeliveryObservation,
    'status' | 'failureReason' | 'smtpStatusCode' | 'enhancedSmtpStatusCode'
  >
): string {
  if (observation.failureReason === 'DnsDomainDoesNotExist') {
    return 'The recipient domain has no usable DNS record. Check the address before retrying.';
  }
  if (observation.smtpStatusCode === '550' && observation.enhancedSmtpStatusCode === '5.7.1') {
    return 'The receiving server refused this message under a policy. The exact recipient-side rule is unavailable to the sender. Review authentication, sender reputation, and message content; a retry alone may fail again.';
  }
  if (observation.status === 'Delivered') {
    return 'The receiving mail server accepted the message. This does not prove inbox placement or that the recipient read it.';
  }
  if (observation.status === 'OutForDelivery') {
    return 'Azure accepted the send, but no final delivery result is shown yet.';
  }
  if (TERMINAL_FAILURES.has(observation.status)) {
    return 'The provider reported a delivery failure. Inspect the status, SMTP code, and recipient domain before retrying.';
  }
  return 'No final delivery result is available from the provider.';
}

export function normalizeAcsDeliveryRow(row: AcsDeliveryRow): EmailDeliveryObservation | null {
  const status = bounded(row.DeliveryStatus, 32);
  const providerMessageId = bounded(row.CorrelationId, 255);
  const observedAt = bounded(row.TimeGenerated, 48);
  if (
    !TERMINAL_FAILURES.has(status) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerMessageId) ||
    Number.isNaN(Date.parse(observedAt))
  ) {
    return null;
  }
  const observation = {
    observedAt,
    provider: 'acs',
    providerMessageId,
    recipientDomain: dnsName(row.RecipientDomain),
    status,
    failureReason: KNOWN_ACS_FAILURE_REASONS.has(bounded(row.FailureReason, 100))
      ? bounded(row.FailureReason, 100)
      : '',
    smtpStatusCode: /^[0-9]{3}$/.test(bounded(row.SmtpStatusCode, 8))
      ? bounded(row.SmtpStatusCode, 8)
      : '',
    enhancedSmtpStatusCode: /^[0-9]\.[0-9]{1,3}\.[0-9]{1,3}$/.test(
      bounded(row.EnhancedSmtpStatusCode, 16)
    )
      ? bounded(row.EnhancedSmtpStatusCode, 16)
      : '',
    recipientMailServer: dnsName(row.RecipientMailServerHostName),
  };
  return { ...observation, diagnosis: diagnoseDelivery(observation) };
}
