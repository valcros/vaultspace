import { describe, expect, it, vi } from 'vitest';

import { resolvePasswordResetAuditScope } from './passwordResetAuditScope';

function client(memberships: string[] = []) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        organizations: memberships.map((organizationId) => ({ organizationId })),
      }),
    },
  };
}

describe('resolvePasswordResetAuditScope', () => {
  it('uses the captured snapshot exactly, deduplicated and sorted', async () => {
    const tx = client(['current-org']);

    const result = await resolvePasswordResetAuditScope(tx as never, {
      userId: 'user-1',
      organizationId: 'legacy-org',
      auditOrganizationIds: ['org-2', 'org-1', 'org-2'],
    });

    expect(result).toEqual({
      organizationIds: ['org-1', 'org-2'],
      source: 'captured_snapshot',
    });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('uses the stored legacy organization before any current-membership fallback', async () => {
    const tx = client(['current-org']);

    const result = await resolvePasswordResetAuditScope(tx as never, {
      userId: 'user-1',
      organizationId: 'legacy-org',
      auditOrganizationIds: [],
    });

    expect(result).toEqual({
      organizationIds: ['legacy-org'],
      source: 'legacy_organization',
    });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('blocks current-membership fallback unless the caller explicitly enables it', async () => {
    const tx = client(['current-org']);

    const result = await resolvePasswordResetAuditScope(tx as never, {
      userId: 'user-1',
      organizationId: null,
      auditOrganizationIds: [],
    });

    expect(result).toEqual({ organizationIds: [], source: 'unavailable' });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('labels explicitly enabled current-membership fallback as legacy evidence', async () => {
    const tx = client(['org-2', 'org-1']);

    const result = await resolvePasswordResetAuditScope(
      tx as never,
      { userId: 'user-1', organizationId: null, auditOrganizationIds: [] },
      { allowLegacyCurrentMembershipFallback: true }
    );

    expect(result).toEqual({
      organizationIds: ['org-1', 'org-2'],
      source: 'legacy_current_memberships',
    });
  });
});
