# Platform Control-Plane Recovery Contract

## Current foundation state

The `20260822100000_add_platform_control_plane_foundation` migration is an additive, default-deny storage foundation. It does not issue platform sessions, create capability grants, write platform audit events, or change existing SysOp authorization. Existing SysOp continuity continues to use `User.isPlatformOperator`.

## Recovery rules

1. Application rollback is image-only and schema-forward. Do not roll back this additive migration.
2. Tenant backup, export, and restore paths exclude platform sessions, capability grants, and platform audit evidence by design.
3. Platform sessions are ephemeral and are invalidated, never restored, after a platform-control recovery.
4. Capability grants are governance history. Their three user foreign keys are `ON DELETE RESTRICT`; a whole-system restore must never erase users with grant history in order to continue.
5. Platform audit evidence is append-only. The standard restore command never deletes, truncates, or restores `platform_audit_events`.
6. If a standard restore encounters a retained platform capability grant, its clearing phase is transactional and rolls back completely. The target is not partially cleared.

## Required future recovery capability before activation

Before any capability grant or platform audit writer is enabled, ship and validate a dedicated platform-control recovery tool with a separate privileged recovery identity. It must:

- Preserve and verify the append-only platform audit ledger.
- Restore active and revoked capability grants only from a verified platform recovery artifact.
- Invalidate all platform sessions after recovery.
- Reconcile usable platform operators against the legacy continuity monitor during the transition.
- Produce an immutable recovery audit record without placing credentials, session tokens, or tenant documents in the ledger.
- Be tested in a disposable non-Brightside PostgreSQL environment.

Until that capability passes its own review, the platform foundation remains inert and default-deny. A standard tenant restore will fail closed rather than risk erasing platform-governance evidence.
