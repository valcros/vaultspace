# Group 4: organization-owned folder templates, implementation review

Date: 2026-10-14 PDT  
Status: Implementation candidate. Database integration, PR, and live verification remain release gates. This version supersedes the plan in version 1.

## Customer behavior

Organization administrators can create, edit, and disable folder templates from Settings. The room picker labels system and organization templates separately. A chosen template creates independent folders in a new or existing room. Disabling a template removes it from future selections without changing existing rooms or deleting its history.

## Ownership and revision rules

Organization templates use the tenant-owned `RoomTemplate` table. New IDs have an `org-` prefix, and writes always set both legacy global/public flags to false. Every management query and mutation includes the current organization ID. The table now has forced row-level security with an organization policy, so the database also rejects cross-tenant access when a query omits its application filter.

Each template has an integer revision. The client sends the reviewed content revision; an update checks it and compares the integer revision in the database write. Concurrent or stale edits return 409. The management screen preserves the draft and offers a reload. A create or update and its tenant audit event share one transaction. The event includes actor, request ID, template ID, numeric revision, prior content revision, and a bounded snapshot.

Input reuses the system catalog's strict tree validation and request-size limit. Active organization admin membership is checked again inside the mutation transaction. Disabled templates are rejected in both room creation and add-to-room routes before folder writes. Global SysOp templates and authorization remain separate.

## Recovery and operational scope

The per-tenant backup classification already includes `RoomTemplate` and restores it in dependency order. Full JSONL backup and restore now include organization templates; older JSONL archives without that file remain readable. Global system templates remain outside tenant restore. The additive migration adds revision and enabled columns, audit event types, and forced tenant RLS. It does not rewrite existing template structures or room folders.

## Review

**Strawman:** Reopen the old POST route and copy the SysOp authorization assumption. That would leave no tenant management flow, revision conflict handling, or database isolation on the legacy table.

**Steelman:** Keep one global catalog for platform operators and a separate tenant-owned service for organization administrators. Require exact tenant IDs at both application and database layers, compare-and-swap revisions, atomic audit, and clear picker labels. This is the implemented candidate.

**Premortem:** A stale edit could overwrite another administrator, a disabled template could still apply through an old browser tab, a legacy public flag could expose another organization's template, or a database read without an org filter could leak data. Revision checks, both room mutation guards, flag-independent resolution, exact filters, and forced RLS address these paths. A malformed tree or failed audit write must abort the transaction. The migration must finish before code using the new columns is deployed. Browser checks must confirm the authoring and conflict UI.

## Verification so far

- Service and route tests cover active-admin checks, tenant-owned IDs and flags, foreign IDs, validation, stale and lost compare-and-swap, disabled state, audit attribution, and audit failure propagation.
- Room creation and add-to-room tests confirm disabled organization templates produce no room or folder writes.
- Component tests cover creating a template through the organization endpoint and preserving an edit after a 409 conflict.
- Local suite: 207 files and 1,815 tests passed; 1 file and 7 tests skipped. Type check, production build, lint, Prisma schema validation, and public repository safety check passed. Lint retained three existing warnings in the users page.
- The disposable PostgreSQL RLS test now checks forced RLS posture and cross-tenant read, update, and insert denial. It awaits CI execution.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUP4_ORG_TEMPLATES_PLAN_2026-10-14_v1.md`
- `prisma/schema.prisma`
- `prisma/migrations/20261014220000_add_org_room_template_revision/migration.sql`
- `prisma/rls-policies.sql`
- `src/services/OrganizationRoomTemplateService.ts`
- `src/lib/rooms/templateCatalog.ts`
- `src/app/api/organization/folder-templates/route.ts`
- `src/components/rooms/FolderTemplateManagement.tsx`
- `tests/integration/rls.test.ts`
- `scripts/backup.ts`
- `scripts/restore.ts`
