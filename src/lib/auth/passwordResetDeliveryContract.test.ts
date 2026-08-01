import { describe, expect, it } from 'vitest';

import {
  canonicalizePasswordResetAuditScope,
  isPasswordResetAuditScopeCanonical,
  passwordResetAuditScopeCardinalityBucket,
} from './passwordResetDeliveryContract';

describe('password reset durable delivery contract', () => {
  it('uses deterministic ASCII ordering and accepts the supported boundary', () => {
    expect(canonicalizePasswordResetAuditScope(['org_b', 'org-A', 'org-1'])).toEqual([
      'org-1',
      'org-A',
      'org_b',
    ]);
    expect(
      canonicalizePasswordResetAuditScope(Array.from({ length: 64 }, (_, i) => `org-${i}`))
    ).toHaveLength(64);
  });

  it.each([
    [[], 'PASSWORD_RESET_AUDIT_SCOPE_EMPTY'],
    [['org-1', 'org-1'], 'PASSWORD_RESET_AUDIT_SCOPE_INVALID'],
    [[' org-1'], 'PASSWORD_RESET_AUDIT_SCOPE_INVALID'],
    [['org.1'], 'PASSWORD_RESET_AUDIT_SCOPE_INVALID'],
    [[`org-${'x'.repeat(100)}`], 'PASSWORD_RESET_AUDIT_SCOPE_INVALID'],
    [Array.from({ length: 65 }, (_, i) => `org-${i}`), 'PASSWORD_RESET_AUDIT_SCOPE_TOO_LARGE'],
  ])('rejects invalid scope %#', (scope, code) => {
    expect(() => canonicalizePasswordResetAuditScope(scope)).toThrow(
      expect.objectContaining({ code })
    );
  });

  it('distinguishes canonical arrays and safe cardinality buckets', () => {
    expect(isPasswordResetAuditScopeCanonical(['org-1', 'org-2'])).toBe(true);
    expect(isPasswordResetAuditScopeCanonical(['org-2', 'org-1'])).toBe(false);
    expect(passwordResetAuditScopeCardinalityBucket(0)).toBe('0');
    expect(passwordResetAuditScopeCardinalityBucket(16)).toBe('1_16');
    expect(passwordResetAuditScopeCardinalityBucket(64)).toBe('17_64');
    expect(passwordResetAuditScopeCardinalityBucket(65)).toBe('65_PLUS');
  });
});
