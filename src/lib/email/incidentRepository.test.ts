import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import type { IncidentEvidence } from './incidentEvidence';
import { insertIncidentEvidence } from './incidentRepository';

const evidence: IncidentEvidence = {
  provider: 'acs',
  providerMessageId: '9e71ee6b-173c-40c5-b29b-48f09c3054dc',
  recipientFingerprint: 'a'.repeat(64),
  recipientFingerprintKeyId: 'test-key',
  recipientDomain: 'vaultspace.test',
  status: 'Bounced',
  failureReason: 'DnsDomainDoesNotExist',
  smtpStatusCode: '550',
  enhancedSmtpStatusCode: '',
  recipientMailServer: '',
  eventAt: new Date('2026-10-13T22:03:35.578Z'),
};

describe('insertIncidentEvidence', () => {
  it('inserts one failure and treats a matching replay as a duplicate', async () => {
    const createMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(evidence);
    const client = {
      emailDeliveryIncident: { createMany, findUnique },
    } as unknown as Pick<PrismaClient, 'emailDeliveryIncident'>;
    expect(await insertIncidentEvidence(client, [evidence, evidence])).toEqual({
      inserted: 1,
      duplicate: 1,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects conflicting evidence for an existing incident', async () => {
    const client = {
      emailDeliveryIncident: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ ...evidence, status: 'Failed' }),
      },
    } as unknown as Pick<PrismaClient, 'emailDeliveryIncident'>;
    await expect(insertIncidentEvidence(client, [evidence])).rejects.toThrow(
      'EMAIL_INCIDENT_EVIDENCE_CONFLICT'
    );
  });

  it('rejects a replay whose event time differs from the stored evidence', async () => {
    const client = {
      emailDeliveryIncident: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          ...evidence,
          eventAt: new Date('2026-10-13T22:03:36.578Z'),
        }),
      },
    } as unknown as Pick<PrismaClient, 'emailDeliveryIncident'>;
    await expect(insertIncidentEvidence(client, [evidence])).rejects.toThrow(
      'EMAIL_INCIDENT_EVIDENCE_CONFLICT'
    );
  });
});
