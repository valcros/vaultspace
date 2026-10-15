# Group 4: organization folder templates, release verification

Date: 2026-10-14 PDT  
Status: Released and verified. This version records the outcome of the plan and implementation reviews in versions 1 and 2.

## Customer outcome

An organization administrator can create, edit, and disable organization-owned folder templates under Settings. The room picker identifies system templates and will identify organization templates separately when present. Choosing one creates independent folders for the current room. Existing rooms and folders do not change when a template is edited or disabled.

The management API requires an active administrator and exact organization ownership. The table has forced tenant row-level security. A stale edit returns 409 and keeps the local draft. Template changes and audit events commit together. Disabled templates are rejected by both room creation and add-to-room paths before folder writes.

## Release evidence

- PR #215 merged as `004e5846a2e5b8a50e4fec2d37428ee2c3228403`. Its PR CI and main CI passed unit tests, type, lint, security, RLS integration, provider event inbox, Azure and standalone modes, production build, image or Docker build, and 181 browser cases.
- Staging deployment run `38653905535` completed successfully for that exact SHA. A read-only public health check returned `healthy`, Azure mode, the exact release SHA, and no degraded capabilities.
- In the signed-in Sarah's Organization session, Settings showed Folder Templates, the management page loaded, and the new-template form exposed name, description, category, enabled state, and folder path fields. The CloudVault Series A room picker showed the system template labels. No template, folder, or file was created or changed during this live check.
- The live check found two identical page headings. PR #217 removed the component copy while preserving the page shell heading. It merged as `cb63061dd72fe07a82f638f3f161cee3857b1e85`. PR and main CI passed, staging run `38658237686` completed successfully, and the public health endpoint reported that exact SHA with no degraded capabilities.
- A final read-only live check on `cb63061` showed one page heading, a loaded template list, and the new-template button. The demo tab was returned to the CloudVault Series A room root.

## Review outcome and limits

The steelman from version 2 was implemented: separate global and tenant template management, exact organization filters, forced database isolation, compare-and-swap revisions, and atomic audit. The premortem cases of stale edits, disabled template reuse, and cross-tenant reads have focused tests and disposable PostgreSQL RLS integration coverage.

The live organization has no organization templates, so the live walkthrough did not exercise a saved template or conflict. Component, route, service, and browser tests use synthetic data for those mutation paths. The live walkthrough was deliberately read-only to keep the demo room showable.

The per-tenant backup path includes `RoomTemplate`. The full JSONL scripts include the table, but a complete cross-tenant JSONL backup requires an elevated database role because forced RLS hides tenant rows from an ordinary app connection. The JSONL recovery path was not drill-tested for this release. Older JSONL archives without `room_templates.jsonl` cannot recreate templates that were absent from those archives.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUP4_ORG_TEMPLATES_PLAN_2026-10-14_v1.md`
- `docs/CUSTOMER_FACING_ROADMAP_GROUP4_ORG_TEMPLATES_PLAN_2026-10-14_v2.md`
- `prisma/migrations/20261014220000_add_org_room_template_revision/migration.sql`
- `src/services/OrganizationRoomTemplateService.ts`
- `src/components/rooms/FolderTemplateManagement.tsx`
- `tests/integration/rls.test.ts`
- `scripts/backup.ts`
- `scripts/restore.ts`
- `https://github.com/valcros/vaultspace/pull/215`
- `https://github.com/valcros/vaultspace/pull/217`
- `https://github.com/valcros/vaultspace/actions/runs/38652252411`
- `https://github.com/valcros/vaultspace/actions/runs/38653905535`
- `https://github.com/valcros/vaultspace/actions/runs/38656650005`
- `https://github.com/valcros/vaultspace/actions/runs/38658237686`
- `https://vaultspace.org/api/health`
