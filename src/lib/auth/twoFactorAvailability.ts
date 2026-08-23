/**
 * MFA enrollment is fail-closed while the deployed end-to-end login path is
 * under remediation. Re-enabling it requires an explicit server environment
 * change after the production-like acceptance suite passes.
 */
export function isTwoFactorEnrollmentEnabled(): boolean {
  return process.env['TWO_FACTOR_ENROLLMENT_ENABLED'] === 'true';
}

export const TWO_FACTOR_ENROLLMENT_UNAVAILABLE_MESSAGE =
  'Two-factor authentication enrollment is temporarily unavailable.';
