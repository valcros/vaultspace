import { describe, expect, it } from 'vitest';

import { assertRetentionRolePosture, type RetentionRolePosture } from './incidentRetentionPosture';

const valid: RetentionRolePosture = {
  role_name: 'vaultspace_email_incident_retention',
  function_owner: 'vaultspaceadmin',
  incident_owner: 'vaultspaceadmin',
  audit_owner: 'vaultspaceadmin',
  can_login: true,
  is_superuser: false,
  bypasses_rls: false,
  can_inherit: false,
  has_memberships: false,
  can_create_database: false,
  can_create_schema: false,
  can_use_schema: true,
  can_execute: true,
  can_grant_execute: false,
  public_execute: false,
  security_definer: true,
  public_table_access: false,
};

const check = (posture: RetentionRolePosture | undefined) =>
  assertRetentionRolePosture(posture, 'vaultspace_email_incident_retention', 'vaultspaceadmin');

describe('retention role posture', () => {
  it('accepts a dedicated EXECUTE-only login', () => {
    expect(() => check(valid)).not.toThrow();
  });

  it.each([
    { public_table_access: true },
    { public_execute: true },
    { can_grant_execute: true },
    { has_memberships: true },
    { bypasses_rls: true },
    { security_definer: false },
    { function_owner: 'unexpected_owner' },
  ])('rejects broader or changed privilege posture %j', (change) => {
    expect(() => check({ ...valid, ...change })).toThrow(
      'EMAIL_INCIDENT_RETENTION_POSTURE_INVALID'
    );
  });

  it('rejects missing and malformed expected identities', () => {
    expect(() => check(undefined)).toThrow('EMAIL_INCIDENT_RETENTION_POSTURE_INVALID');
    expect(() => assertRetentionRolePosture(valid, 'x; DROP ROLE', 'vaultspaceadmin')).toThrow(
      'EMAIL_INCIDENT_RETENTION_POSTURE_INVALID'
    );
  });
});
