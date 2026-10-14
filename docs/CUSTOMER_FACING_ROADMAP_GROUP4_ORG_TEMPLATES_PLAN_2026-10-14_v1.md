# Group 4: organization-owned folder templates

Date: 2026-10-14 PDT  
Status: Design review and implementation plan

## Customer outcome

An organization administrator can save, revise, and disable reusable folder structures for future rooms. The template picker distinguishes organization templates from system templates. Applying either template creates independent room-owned folders. Editing or disabling a template never changes an existing room.

## Existing boundary

The global system catalog and its SysOp authoring remain separate. The existing `RoomTemplate` records belong to one organization, but organization authoring is currently disabled. Legacy `isPublic` and `isSystemTemplate` flags do not grant global access. Room creation and add-to-room already resolve a template inside the room transaction, require its reviewed revision, and enforce folder selection and path collision rules.

## Proposed contract

1. Only an active administrator of the current organization may create, edit, or disable its templates. Reads return only that organization's records plus the separate enabled system catalog.
2. Template input uses the bounded, strict folder validation already used by system templates. New tenant records have organization ownership and no global/public flags.
3. Each tenant template has an integer revision. Editing requires the displayed revision and uses compare-and-swap. A stale edit receives 409 and keeps the user's draft available for review.
4. A disabled template remains available in management history but cannot be selected for a new room or added to an existing room. Existing room folders remain independent.
5. Create, update, and disable commit with a tenant audit event containing actor, request ID, template ID, revision, and a bounded snapshot. No template is physically deleted through this workflow.
6. The management page explains scope and the effect of edits, supports reload after conflicts, and guards unsaved changes.

## Decision review

**Strawman:** Reopen the old organization POST route and reuse the SysOp form. This lacks an explicit revision contract, disabled state, tenant audit, and management navigation. It also risks treating legacy public/system flags as authority.

**Steelman:** Add tenant-specific service and routes over the existing `RoomTemplate` table, with exact organization filters on every read and mutation, active-admin checks, integer revisions, atomic audit, and a dedicated organization UI. Keep the global catalog and its operator policy untouched.

**Premortem:** A foreign template ID or legacy flag could cross a tenant boundary; every query must include organization ID and tests must exercise foreign IDs. Two admins could overwrite each other; writes must compare revisions. A disabled template could still apply through a bookmarked picker; both room mutation paths must reject it. A malformed tree could create partial folders; validation occurs before the room transaction writes. A failed audit write must roll back the template mutation. Deployment must apply the additive schema migration before the new code.

## Verification gates

- Service and route tests for active-admin authorization, foreign IDs, strict input, create/update/disable, stale revisions, and atomic audit failure.
- Room creation and existing-room tests for disabled tenant templates, changed revisions, and no partial folder writes.
- Full unit/integration, type, lint, build, security, and browser checks. Browser review uses a disposable organization or synthetic data, not the demo room.
- PR and staging deployment checks at an exact commit before release verification.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUPS_AND_GROUP1_PLAN_2026-10-14_v3.md`
- `docs/SYSTEM_FOLDER_TEMPLATES_PLAN_2026-10-09_v1.md`
- `prisma/schema.prisma`
- `src/services/SystemRoomTemplateService.ts`
- `src/lib/rooms/templateCatalog.ts`
- `src/app/api/rooms/templates/route.ts`
- `src/app/api/rooms/route.ts`
- `src/app/api/rooms/[roomId]/folders/starter/route.ts`
