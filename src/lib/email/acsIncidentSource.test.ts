import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    async getToken() {
      return { token: 'test-token' };
    }
  },
}));

import { listAcsIncidentEvidence } from './acsIncidentSource';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ACS incident source', () => {
  it('keeps valid failures when another provider row is malformed', async () => {
    vi.stubEnv(
      'ACS_COMMUNICATION_RESOURCE_ID',
      '/subscriptions/041a67eb-fec8-41a4-9d70-c35863268cd6/resourceGroups/rg-vaultspace-staging/providers/Microsoft.Communication/CommunicationServices/acs-vaultspace-staging'
    );
    const columns = [
      'TimeGenerated',
      'CorrelationId',
      'RecipientId',
      'RecipientDomain',
      'DeliveryStatus',
      'FailureReason',
      'SmtpStatusCode',
      'EnhancedSmtpStatusCode',
      'RecipientMailServerHostName',
    ].map((name) => ({ name }));
    const valid = [
      '2026-10-13T22:03:35.578Z',
      '9e71ee6b-173c-40c5-b29b-48f09c3054dc',
      'valid@vaultspace.test',
      'vaultspace.test',
      'Bounced',
      'DnsDomainDoesNotExist',
      '550',
      '',
      '',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tables: [
            { columns, rows: [valid, [...valid.slice(0, 2), 'bad-address', ...valid.slice(3)]] },
          ],
        }),
      })
    );

    const result = await listAcsIncidentEvidence({ id: 'test-key', bytes: Buffer.alloc(32, 7) });
    expect(result.invalidRows).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.recipientDomain).toBe('vaultspace.test');
    expect(JSON.stringify(result)).not.toContain('valid@vaultspace.test');
    expect(JSON.stringify(result)).not.toContain('bad-address');
  });
});
