import { describe, expect, it } from 'vitest';

import { assertIncidentCollectorPosture } from './emailDeliveryIncidentPreflight';

const role = 'vaultspace_email_incident_ingress';
const owner = 'vaultspace_migrator';
const valid = {
  role_name: role,
  owner_name: owner,
  can_login: true,
  is_superuser: false,
  bypasses_rls: false,
  can_inherit: false,
  has_memberships: false,
  can_create_database: false,
  can_create_schema: false,
  can_select: true,
  can_insert: true,
  can_update: false,
  can_delete: false,
  can_truncate: false,
  can_reference: false,
  can_trigger: false,
  can_grant_select: false,
  can_grant_insert: false,
  can_update_column: false,
  public_table_access: false,
  other_table_access: false,
  guard_trigger_present: true,
};

describe('incident collector database posture', () => {
  it('accepts only the dedicated read and insert role', () => {
    expect(() => assertIncidentCollectorPosture(valid, role, owner)).not.toThrow();
  });

  it.each([
    { can_update: true },
    { can_delete: true },
    { can_inherit: true },
    { has_memberships: true },
    { is_superuser: true },
    { bypasses_rls: true },
    { can_create_schema: true },
    { other_table_access: true },
    { public_table_access: true },
    { guard_trigger_present: false },
  ])('rejects privilege or guard drift', (change) => {
    expect(() => assertIncidentCollectorPosture({ ...valid, ...change }, role, owner)).toThrow(
      'EMAIL_INCIDENT_COLLECTOR_POSTURE_INVALID'
    );
  });

  it('rejects a different owner or role', () => {
    expect(() => assertIncidentCollectorPosture(valid, 'vaultspace_app', owner)).toThrow(
      'EMAIL_INCIDENT_COLLECTOR_POSTURE_INVALID'
    );
    expect(() => assertIncidentCollectorPosture(valid, role, 'other_owner')).toThrow(
      'EMAIL_INCIDENT_COLLECTOR_POSTURE_INVALID'
    );
  });
});
