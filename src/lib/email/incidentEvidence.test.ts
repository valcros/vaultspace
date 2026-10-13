import { describe, expect, it } from 'vitest';

import { normalizeAcsIncidentEvidence } from './incidentEvidence';

const fingerprintKey = { id: 'test-key', bytes: Buffer.alloc(32, 7) };
const baseRow = {
  TimeGenerated: '2026-10-13T22:03:35.578Z',
  CorrelationId: '9e71ee6b-173c-40c5-b29b-48f09c3054dc',
  RecipientId: 'first@vaultspace.test',
  RecipientDomain: 'vaultspace.test',
  DeliveryStatus: 'Bounced',
  FailureReason: 'DnsDomainDoesNotExist',
  SmtpStatusCode: '550',
  EnhancedSmtpStatusCode: '',
  RecipientMailServerHostName: '',
};

describe('normalizeAcsIncidentEvidence', () => {
  it('distinguishes recipients on the same send without retaining their addresses', () => {
    const first = normalizeAcsIncidentEvidence(baseRow, fingerprintKey);
    const second = normalizeAcsIncidentEvidence(
      { ...baseRow, RecipientId: 'second@vaultspace.test' },
      fingerprintKey
    );
    expect(first.recipientFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.recipientFingerprint).not.toBe(first.recipientFingerprint);
    expect(first).toMatchObject({
      provider: 'acs',
      providerMessageId: baseRow.CorrelationId,
      recipientDomain: 'vaultspace.test',
      status: 'Bounced',
      smtpStatusCode: '550',
    });
    expect(JSON.stringify(first)).not.toContain('first@vaultspace.test');
  });

  it('normalizes the domain while preserving local-part identity in the fingerprint', () => {
    const lower = normalizeAcsIncidentEvidence(baseRow, fingerprintKey);
    const upperDomain = normalizeAcsIncidentEvidence(
      { ...baseRow, RecipientId: 'first@VAULTSPACE.TEST' },
      fingerprintKey
    );
    const upperLocal = normalizeAcsIncidentEvidence(
      { ...baseRow, RecipientId: 'First@vaultspace.test' },
      fingerprintKey
    );
    expect(upperDomain.recipientFingerprint).toBe(lower.recipientFingerprint);
    expect(upperLocal.recipientFingerprint).not.toBe(lower.recipientFingerprint);
  });

  it('rejects a mismatched recipient domain before persistence', () => {
    expect(() =>
      normalizeAcsIncidentEvidence({ ...baseRow, RecipientDomain: 'other.test' }, fingerprintKey)
    ).toThrow('EMAIL_INCIDENT_RECIPIENT_DOMAIN_MISMATCH');
  });

  it('rejects malformed recipient evidence without exposing the address', () => {
    expect(() =>
      normalizeAcsIncidentEvidence({ ...baseRow, RecipientId: 'bad-address' }, fingerprintKey)
    ).toThrow('EMAIL_INCIDENT_RECIPIENT_OR_KEY_INVALID');
  });
});
