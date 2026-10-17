import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

import { resolveEligibleSource } from './sourceEligibility';

function tx(
  scanStatus: string,
  enabled = true,
  roomStatus = 'ACTIVE',
  orgActive = true,
  orgAiEnabled = true
) {
  const findFirst = vi.fn().mockResolvedValue({
    roomId: 'room-a',
    organization: { isActive: orgActive, aiEnabled: orgAiEnabled },
    room: { status: roomStatus, mode: 'INDEPENDENT' },
    versions:
      scanStatus === 'MISSING'
        ? []
        : [
            {
              id: 'version-a',
              scanStatus,
              fileSha256: 'a'.repeat(64),
              mimeType: 'text/plain',
              fileBlob: { storageBucket: 'documents', storageKey: 'org-a/file' },
            },
          ],
  });
  const policy = vi.fn().mockResolvedValue(enabled ? { id: 'policy-a' } : null);
  const candidate = { document: { findFirst }, aiPolicy: { findFirst: policy } };
  return candidate as typeof candidate & Prisma.TransactionClient;
}

describe('AI source eligibility', () => {
  it('requires a CLEAN current source under enabled room policy', async () => {
    const clean = tx('CLEAN');
    expect(await resolveEligibleSource(clean, 'org-a', 'doc-a', 'version-a')).toMatchObject({
      organizationId: 'org-a',
      documentId: 'doc-a',
      versionId: 'version-a',
    });
    expect(clean.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          currentVersionId: 'version-a',
          status: 'ACTIVE',
          deletedAt: null,
          withdrawnAt: null,
        }),
      })
    );
  });

  it.each(['SKIPPED', 'PENDING', 'SCANNING', 'INFECTED', 'ERROR', 'MISSING'])(
    'rejects %s versions',
    async (state) => {
      expect(await resolveEligibleSource(tx(state), 'org-a', 'doc-a', 'version-a')).toBeNull();
    }
  );

  it('rejects disabled and inactive rooms', async () => {
    expect(
      await resolveEligibleSource(tx('CLEAN', false), 'org-a', 'doc-a', 'version-a')
    ).toBeNull();
    expect(
      await resolveEligibleSource(tx('CLEAN', true, 'CLOSED'), 'org-a', 'doc-a', 'version-a')
    ).toBeNull();
    expect(
      await resolveEligibleSource(tx('CLEAN', true, 'ACTIVE', false), 'org-a', 'doc-a', 'version-a')
    ).toBeNull();
    expect(
      await resolveEligibleSource(
        tx('CLEAN', true, 'ACTIVE', true, false),
        'org-a',
        'doc-a',
        'version-a'
      )
    ).toBeNull();
  });
});
