export const PASSWORD_RESET_DELIVERY_CONTRACT_VERSION = 1 as const;
export const PASSWORD_RESET_AUDIT_SCOPE_WARNING_SIZE = 16;
export const PASSWORD_RESET_AUDIT_SCOPE_MAX_SIZE = 64;

const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type PasswordResetAuditScopeErrorCode =
  | 'PASSWORD_RESET_AUDIT_SCOPE_EMPTY'
  | 'PASSWORD_RESET_AUDIT_SCOPE_TOO_LARGE'
  | 'PASSWORD_RESET_AUDIT_SCOPE_INVALID';

export class PasswordResetAuditScopeError extends Error {
  constructor(
    public readonly code: PasswordResetAuditScopeErrorCode,
    public readonly cardinality: number
  ) {
    super('Password reset audit scope is not eligible for durable delivery');
    this.name = 'PasswordResetAuditScopeError';
  }
}

/**
 * Canonicalize a locked membership snapshot for account-global reset auditing.
 * IDs are restricted to an ASCII grammar so JavaScript code-point ordering and
 * PostgreSQL COLLATE "C" ordering have the same result.
 */
export function canonicalizePasswordResetAuditScope(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new PasswordResetAuditScopeError('PASSWORD_RESET_AUDIT_SCOPE_EMPTY', 0);
  }
  if (values.length > PASSWORD_RESET_AUDIT_SCOPE_MAX_SIZE) {
    throw new PasswordResetAuditScopeError('PASSWORD_RESET_AUDIT_SCOPE_TOO_LARGE', values.length);
  }
  if (
    values.some(
      (value) =>
        typeof value !== 'string' || value !== value.trim() || !ORGANIZATION_ID_PATTERN.test(value)
    )
  ) {
    throw new PasswordResetAuditScopeError('PASSWORD_RESET_AUDIT_SCOPE_INVALID', values.length);
  }
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new PasswordResetAuditScopeError('PASSWORD_RESET_AUDIT_SCOPE_INVALID', values.length);
  }
  return [...unique].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function passwordResetAuditScopeCardinalityBucket(cardinality: number): string {
  if (cardinality <= 0) {
    return '0';
  }
  if (cardinality <= PASSWORD_RESET_AUDIT_SCOPE_WARNING_SIZE) {
    return '1_16';
  }
  if (cardinality <= PASSWORD_RESET_AUDIT_SCOPE_MAX_SIZE) {
    return '17_64';
  }
  return '65_PLUS';
}

export function isPasswordResetAuditScopeCanonical(values: readonly string[]): boolean {
  try {
    const canonical = canonicalizePasswordResetAuditScope(values);
    return canonical.every((value, index) => value === values[index]);
  } catch {
    return false;
  }
}
