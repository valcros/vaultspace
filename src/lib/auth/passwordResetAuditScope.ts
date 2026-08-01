import type { Prisma } from '@prisma/client';

export type PasswordResetAuditScopeSource =
  | 'captured_snapshot'
  | 'legacy_organization'
  | 'legacy_current_memberships'
  | 'unavailable';

export interface PasswordResetAuditScope {
  organizationIds: string[];
  source: PasswordResetAuditScopeSource;
}

interface PasswordResetAuditScopeInput {
  userId: string;
  organizationId: string | null;
  auditOrganizationIds?: string[];
}

function normalizedOrganizationIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/**
 * Resolve the tenant audit scope without accepting organization information
 * from external provider events. Captured snapshots are authoritative. Legacy
 * current-membership fallback is opt-in and must not be used for provider-final
 * delivery projection.
 */
export async function resolvePasswordResetAuditScope(
  tx: Pick<Prisma.TransactionClient, 'user'>,
  reset: PasswordResetAuditScopeInput,
  options?: { allowLegacyCurrentMembershipFallback?: boolean }
): Promise<PasswordResetAuditScope> {
  const captured = normalizedOrganizationIds(reset.auditOrganizationIds ?? []);
  if (captured.length > 0) {
    return { organizationIds: captured, source: 'captured_snapshot' };
  }

  if (reset.organizationId?.trim()) {
    return {
      organizationIds: [reset.organizationId.trim()],
      source: 'legacy_organization',
    };
  }

  if (!options?.allowLegacyCurrentMembershipFallback) {
    return { organizationIds: [], source: 'unavailable' };
  }

  const user = await tx.user.findUnique({
    where: { id: reset.userId },
    select: { organizations: { select: { organizationId: true } } },
  });
  const current = normalizedOrganizationIds(
    (user?.organizations ?? []).map((membership) => membership.organizationId)
  );
  return {
    organizationIds: current,
    source: current.length > 0 ? 'legacy_current_memberships' : 'unavailable',
  };
}
