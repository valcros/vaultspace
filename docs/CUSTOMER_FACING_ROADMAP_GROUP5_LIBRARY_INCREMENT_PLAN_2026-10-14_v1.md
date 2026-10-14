# Customer-facing roadmap group 5: Company Content Library increment plan

Date: 2026-10-14 PDT  
Status: Proposed implementation sequence for review. No library data or customer rooms have been changed.

## Outcome and boundaries

An organization administrator can maintain one canonical company document and deliberately publish a specific clean version into an audience room. A viewer sees only the version published in that room. Independent rooms and their existing documents remain independent. Existing rooms, links, and documents are not converted automatically.

This work is larger than a single release. Each increment must be independently reviewed, tested, and reversible with a feature flag. The feature remains off for customer organizations until the full view-aware authorization matrix passes. A hidden schema or admin catalog alone is not a customer release.

## Decisions for the first release

| Question                                            | Initial rule                                                                                                                   | Reason and later option                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Who may upload, publish, unpublish, and archive?    | An active organization administrator. Recheck membership and user state inside the tenant transaction.                         | One role boundary is testable. A separate publisher role can follow an audited permission design.                                   |
| Can one document appear more than once in one room? | One active placement per room.                                                                                                 | Avoid ambiguous paths, links, and activity.                                                                                         |
| What happens when a new version is uploaded?        | Existing room views stay pinned to their published version.                                                                    | No audience receives a new version by accident.                                                                                     |
| What happens on library archive?                    | Show every affected room and block archive while any active binding remains. Require explicit unpublish from each room first.  | Prevent a canonical change from silently breaking a published room.                                                                 |
| What retention applies?                             | No automatic purge is promised. Hard deletion is unavailable while versions or bindings may be required for audit or recovery. | The existing generic document expiry and trash cleanup are not implemented, so retention enforcement needs its own reviewed design. |
| Who can see the library before publication?         | Only active organization administrators in the first release.                                                                  | Room viewers and ordinary members receive no library listing or counts.                                                             |

These are proposed defaults for the implementation review. A customer-specific policy or legal hold must be set from that customer's controlling record, not inferred from a demo organization.

## Increment 5A: deny-by-default foundation

1. Add an organization opt-in flag that defaults off, an immutable room mode that defaults to `INDEPENDENT`, and new organization-scoped library and binding tables. Keep existing document, folder, version, and link records unchanged.
2. Define database constraints for organization equality among the room, library item, version, and binding. Add and test forced tenant RLS. A binding may select only a version of its own library document.
3. Build one resolver for `(organization, room, active published binding, exact published version, actor or viewer link)`. It returns the same external result for absent and unauthorized content. Every future file, search, list, link, and export path must call this resolver or a proved equivalent query.
4. Add internal diagnostics and audit events for draft, publish, unpublish, version pin change, and blocked archive. Diagnostics may identify the authorized organization and binding internally but must not leak another audience's title in a response.
5. Prove the permission matrix with two organizations, two room audiences in one organization, distinct pinned versions, unpublished bindings, revoked links, archive attempts, and a scanning version. The feature stays off after this increment.

5A acceptance: existing independent-room tests remain green; cross-tenant and cross-view attempts reveal no title, snippet, count, file, or storage URL; flag-off requests reject library operations; additive migration and rollback path are documented.

## Increment 5B: administrator library catalog

Add an administrator-only library UI and API for folders, upload, scan state, preview, and version history. Reuse the existing storage, scanning, preview, and integrity services only where their room-specific assumptions have been removed or adapted explicitly. Upload must commit metadata, version, blob reference, and audit atomically, with storage cleanup on failure. No publishing UI or viewer access is enabled in 5B.

5B acceptance: an administrator can find and inspect the canonical item and its versions; a non-administrator cannot enumerate it; a scanning or failed version cannot be served; backup and restore include the new tenant records; a feature-off organization cannot reach the catalog.

## Increments required before a customer pilot

- **5C, publishing workflow:** create a Company View Room, place draft bindings, preview the exact audience tree and version, then publish explicitly. Display the room mode and version pin. Unpublish affects one room only. No automatic version follow.
- **5D, every serving surface:** make member search, room tree, counts, preview, download, thumbnails, public links, viewer sessions, export jobs, notifications, Q&A, bookmarks, and activity view-aware. Recheck binding state at request time and again in long-running export work. Freeze an authorized export manifest.
- **5E, controlled pilot:** use a dedicated test organization with overlapping audiences. Verify keyboard and mobile publishing, revoked-link behavior, version pinning, archive impact, zero-leak search and export, diagnostics, and flag rollback. Keep demo rooms free of test content.

No Company View Room is customer-visible until 5C and 5D both pass. A release must show actual behavior in a signed-in and external-viewer walkthrough, not only unit tests.

## Three-pass review

- **Strawman:** Copy a source document into every room. This can be a deliberate independent snapshot, but it creates divergent histories and makes revocation across rooms manual.
- **Steelman:** A canonical version chain with explicit per-room bindings and pinned versions makes disclosure observable. A single resolver and binding-first queries make the audience boundary testable at each serving surface.
- **Premortem:** A search total reveals an unpublished title; a stale viewer session serves an unpublished version; an export job includes a file after revocation; an archive breaks a room; a new version reaches the wrong audience. Binding-first search, serve-time and worker-time rechecks, blocked archive while bound, explicit version pins, and zero-leak integration tests are release gates.

## Dependencies and review gates

Group 4 organization folder templates should release before Company View Room creation uses starter structures. Group 3 preview should remain stable before library previews reuse its rendering path. The first code PR should contain 5A only. Subsequent PRs should not weaken the flag-off state or independent-room permissions. Each PR needs schema and API review, tenant isolation tests, security review, full CI, and an exact deployed-build check before the next increment is enabled.

## References

- `docs/COMPANY_CONTENT_LIBRARY_PHASE2_DISCOVERY_2026-10-13_v1.md`
- `docs/ROOM_VIEWS_AND_STARTER_FOLDERS_DESIGN_2026-09-02_v1.md`
- `docs/CUSTOMER_FACING_ROADMAP_GROUPS_AND_GROUP1_PLAN_2026-10-14_v3.md`
- `prisma/schema.prisma`
- `src/app/api/search/route.ts`
- `src/app/api/view/[shareToken]/documents/route.ts`
- `src/app/api/rooms/[roomId]/export/route.ts`
