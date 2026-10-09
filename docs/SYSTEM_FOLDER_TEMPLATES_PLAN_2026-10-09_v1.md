# System folder template management

## Owner-approved boundary

Platform Operators manage shared folder templates through SysOp. Organization ADMIN does not imply platform authority. Organization admins choose folder checkboxes when applying a template. Existing rooms own independent folder copies and never synchronize with later template changes.

This increment supplies system template creation, editing, enabling/disabling, validation, revision conflicts, and audit evidence. Per-use additional folders and organization-owned reusable template authoring are follow-ons in BACKLOG.md. Existing tenant templates remain readable within their exact organization; their existing authoring endpoint is disabled. No tenant record is deleted or promoted into the global catalog.

## Decision review

- **Strawman:** editable shared defaults with the existing SysOp guard and folder picker. A form alone is insufficient because the old organization-admin creation API and legacy public/system flags would preserve unintended authoring and access paths.
- **Steelman:** a separate global catalog with immutable revision evidence, one resolver for listing and both creation paths, stable built-in IDs, and optimistic concurrency. Reusing tenant RoomTemplate would tie global settings to tenant deletion and restore. Extending PlatformAuditEvent would require changing its deliberately sealed control-plane ledger and privileges; a bounded template revision ledger avoids that unrelated change.
- **Premortem:** stale checkboxes create an unexpected tree, a disabled default reappears, simultaneous operators overwrite edits, a policy-store outage bypasses SysOp restrictions, or tenant restore overwrites global settings. Gates cover revision checks, disabled overrides, fail-closed reads and IP checks, compare-and-swap writes, atomic audit, exact tenant filters, and backup classification.

## Implementation

1. Add SystemRoomTemplate and append-only SystemRoomTemplateRevision, without tenant/user cascade foreign keys. Keep existing built-in IDs and create new system IDs under `sys-`.
2. Use source defaults only when no database override exists. Database failure and disabled overrides never reactivate defaults. Source-content hashes ensure changed bundled definitions also invalidate selections.
3. Gate every management endpoint with requirePlatformOperator, including the current persisted grant and IP policy. Recheck the operator in the mutation transaction. Organization membership role does not substitute for this grant. Use the regular application database client, not the privileged auth-bootstrap connection.
4. Commit catalog mutation and immutable revision snapshot together. Protect audit evidence from update, delete, and truncate. Runtime SQL is a trusted service boundary: its role has catalog SELECT/INSERT/UPDATE and revision SELECT/INSERT, while per-user authorization is enforced by application guards.
5. Require the reviewed revision on operator saves and room-template applications. A mismatch returns 409 and asks the user to reload. Resolve the definition once inside the room transaction: it is valid at that catalog read; an operator edit committed afterward affects the next use. Existing-room path collisions retain atomic 409 behavior.
6. Validate the entire tree, not only a selected subset: bounded request bytes, metadata and path lengths, at most 100 folders, valid paths, unique paths and sibling names, all required ancestors, and the existing depth cap.
7. Preserve tenant isolation for legacy templates using exact organization ID. Legacy public/system flags do not grant global authority. Personalized catalog responses are private and not cached.

## Validation and release gates

- Service tests: defaults/overrides, disabled state, DB failure, validation, stale revision, concurrent first override and update, operator revocation, audit failure.
- API tests: unauthenticated and unauthorized requests cannot reach management reads/writes; bounded/strict request validation; deferred org authoring rejection.
- Room tests: changed or missing revision and disabled/foreign template produce zero partial writes; selected folders and automatic ancestors remain correct.
- Database integration: additive migration and intended runtime grants, audit immutability, retained history. Run through disposable CI PostgreSQL, never local Docker or customer data.
- Browser verification: create/edit/disable form, accessible rows, conflict recovery, checkbox selection, mobile layout, and non-operator access denial.
- Required type, lint, unit, integration, and build checks before a release. A draft PR can expose the implementation before deployment.

## Migration and recovery

The migration adds tables and does not rewrite tenant folders or templates. Deploy it before code that reads the catalog. No credential, network, identity, or C1-C7 infrastructure changes are included.

Global tables are excluded from tenant backup/restore. The platform JSONL backup includes catalog and revision evidence. Generic JSONL restore preserves live global settings and explicitly reports that it does not import these tables. Full-database recovery must include both tables together. No recovery or live database mutation is performed during implementation.

An older application release will ignore database overrides and use its bundled defaults. Therefore rollback after operators start editing can re-enable or change offered templates. Prefer a forward fix; assess this behavioral consequence before an older-code rollback. Do not delete override rows to reset revisions.

## Sources

Existing requirePlatformOperator and SysOp IP policy, starterFolderTemplates contract, RoomTemplate and PlatformAuditEvent schema, tenant backup classification, and the owner’s October 9 instructions. Strawman, steelman, and premortem reviews were performed before implementation.
