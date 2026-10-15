# Group 5A Company Content Library foundation review

Date: 2026-10-14 PDT  
Status: Implementation review. No customer feature has been enabled.

## Scope completed

- Added an organization flag defaulting to false and a room mode defaulting to `INDEPENDENT`. Existing rooms retain their current behavior. Room mode cannot change after creation.
- Added canonical library folders, documents, immutable numbered versions, file references, room folder placements, and room document bindings. Composite foreign keys require the room, placement, document, and pinned version to belong to the same organization. A pinned version must belong to the bound document.
- Added forced tenant row level security for all six new tables in the migration, policy script, and RLS repair inventory.
- Added a private, deny by default resolver for an active organization administrator and an active Company View room. It requires a published binding, visible placement ancestors, unarchived canonical ancestors, a clean pinned version, and its file reference. The viewer link branch returns no content until the later serving work is reviewed.
- Classified all new rows in tenant backup and restore order, included library file references in the blob export, and included the new tables in the older full JSONL export and restore path. Existing backup recovery limitations remain; no recovery drill has been claimed.
- Added event names for later publisher audit transitions. There are no publishing, viewer, search, download, or export routes in this increment.

## Three pass review

**Strawman.** Add a library table and reuse room document routes immediately. Those routes assume one document belongs to one room and could reveal a canonical title or the latest version to the wrong audience.

**Steelman.** Keep canonical versions and audience bindings distinct. Enforce tenant and version relationships in the database, then make every serving path resolve the exact active binding and pinned version. Roll out catalog, publishing, and viewer surfaces in separate increments behind explicit flags.

**Premortem.** The likely failures are an accidental cross-organization binding, a stale published version after a malware verdict changes, a hidden ancestor still being served, a backup omitting a new table or blob, and a customer route reading the canonical library directly. Composite keys, forced RLS, serve-time checks, backup classification, and no customer routes address those risks now. The later increments must prove every list, count, search, preview, link, download, and export surface against two room audiences before enablement.

## Verification and release gate

Local Prisma validation, TypeScript, lint, formatting, repository safety, and focused resolver and backup classification tests passed. PostgreSQL and Docker are unavailable on this workstation, so migration execution and the new RLS integration cases require the disposable CI database. The foundation PR must pass those checks, full application tests, build, and security scan before merge. After merge, verify the exact staging build and health, and confirm `COMPANY_LIBRARY_ENABLED` remains false. Do not create a customer Company View Room or enable the flag in 5A.

The migration is additive. A rollback can disable the global flag and redeploy the preceding application version. Do not drop the new tables as a routine rollback, because later increments may place recoverable tenant content there. Any destructive database rollback requires its own data review.

## Next increment

Build the organization administrator catalog and upload workflow in 5B. Before customer use, add atomic metadata and audit writes, blob cleanup on failure, scan and preview integration, exact organization authorization, and a disposable backup and restore drill. Publishing and viewer access remain later gates.

## References

- `docs/CUSTOMER_FACING_ROADMAP_GROUP5_LIBRARY_INCREMENT_PLAN_2026-10-14_v1.md`
- `prisma/schema.prisma`
- `prisma/migrations/20261015004000_company_library_foundation/migration.sql`
- `src/services/CompanyLibraryResolver.ts`
- `tests/integration/rls.test.ts`
- `src/lib/backup/tenantModelClassification.ts`
