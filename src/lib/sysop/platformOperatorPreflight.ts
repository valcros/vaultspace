/**
 * Shared continuity checks for the platform-operator control plane.
 *
 * SysOp access is intentionally an explicit, global entitlement. These helpers
 * keep the release and operator-management tooling fail-closed when that
 * entitlement would otherwise have no active holder.
 */

export const NO_ACTIVE_PLATFORM_OPERATOR_ERROR =
  'No active platform operator exists. Refusing to continue until an operator is granted.';

export const LAST_ACTIVE_PLATFORM_OPERATOR_ERROR =
  'Refusing to revoke the last active platform operator. Grant a successor first, or use the documented break-glass override.';

export function resolvePlatformOperatorDatabaseUrl(
  environment: Record<string, string | undefined>
): string | null {
  return (
    environment['DATABASE_URL_ADMIN'] ??
    environment['MIGRATION_DATABASE_URL'] ??
    environment['DATABASE_URL'] ??
    null
  );
}

export function assertActivePlatformOperatorCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(NO_ACTIVE_PLATFORM_OPERATOR_ERROR);
  }
}

export function assertLastActivePlatformOperatorIsRetained(count: number): void {
  if (!Number.isInteger(count) || count <= 1) {
    throw new Error(LAST_ACTIVE_PLATFORM_OPERATOR_ERROR);
  }
}

export function assertSysopRolloutReadiness(
  counts: {
    activeMfaOperators: number;
    consoleReadyOperators: number;
    capabilityManagers: number;
  },
  environment: Record<string, string | undefined>
): void {
  if (
    environment['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] === 'true' &&
    environment['SYSOP_MODE_ENFORCEMENT_ENABLED'] !== 'true'
  ) {
    throw new Error('Enable SysOp mode enforcement before capability enforcement.');
  }
  if (environment['SYSOP_MODE_ENFORCEMENT_ENABLED'] === 'true' && counts.activeMfaOperators < 1) {
    throw new Error('SysOp mode enforcement requires an active MFA-enrolled operator.');
  }
  if (
    environment['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] === 'true' &&
    (counts.consoleReadyOperators < 1 || counts.capabilityManagers < 1)
  ) {
    throw new Error(
      'Capability enforcement requires an MFA-enrolled console operator and capability manager.'
    );
  }
}
