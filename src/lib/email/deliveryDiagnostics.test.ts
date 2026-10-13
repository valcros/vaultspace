import { describe, expect, it } from 'vitest';
import { diagnoseDelivery, normalizeAcsDeliveryRow } from './deliveryDiagnostics';

describe('email delivery diagnostics', () => {
  it('reports policy rejection without claiming the recipient private rule', () => {
    const result = normalizeAcsDeliveryRow({
      TimeGenerated: '2026-10-13T19:06:58.786Z',
      CorrelationId: '00000000-0000-4000-8000-000000000001',
      RecipientDomain: 'recipient.example',
      DeliveryStatus: 'Failed',
      FailureReason: 'DeliveryNotAuthorizedMessageRefused',
      SmtpStatusCode: '550',
      EnhancedSmtpStatusCode: '5.7.1',
      RecipientMailServerHostName: 'aspmx.l.google.com',
    });

    expect(result?.diagnosis).toContain('exact recipient-side rule is unavailable');
    expect(result?.recipientDomain).toBe('recipient.example');
    expect(JSON.stringify(result)).not.toContain('person@');
  });

  it('distinguishes a nonexistent domain from a policy rejection', () => {
    expect(
      diagnoseDelivery({
        status: 'Bounced',
        failureReason: 'DnsDomainDoesNotExist',
        smtpStatusCode: '550',
        enhancedSmtpStatusCode: '5.4.310',
      })
    ).toContain('recipient domain');
  });

  it('does not turn malformed provider rows into incidents', () => {
    expect(normalizeAcsDeliveryRow({ DeliveryStatus: 'Failed' })).toBeNull();
  });
});
