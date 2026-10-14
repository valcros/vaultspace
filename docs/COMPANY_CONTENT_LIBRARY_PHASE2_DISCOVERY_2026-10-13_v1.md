# Company Content Library and audience room views: Phase 2 discovery

Date: 2026-10-13 PDT / 2026-10-14 UTC  
Status: Design recommendation for review. No schema or customer-data migration is authorized by this document.

## Product contract

An organization may keep a canonical set of company documents and publish selected items into Investor, Board, M&A, or Compliance room views. A room view has its own layout, access rules, links, activity, and publication state. The existing independent room remains available for isolated deals and client work. Room creation must ask which mode is intended and explain the difference before any content is added.

Publishing is explicit. A newly uploaded library version stays in the library until an authorized publisher releases that version to each affected room view. A room view can pin a version. Removing a document from one view changes only that view. Archiving canonical content shows the affected views and requires a separate privileged action. Existing rooms do not convert automatically.

## Current implementation constraints

- `Room`, `Folder`, and `Document` are one-to-many, with required `roomId` on folders and documents. `DocumentVersion` belongs to one document. Adding another room ID to `Folder` cannot express one canonical version history safely.
- `/api/search` joins search indexes to `documents.roomId`, then authorizes each candidate before returning snippets and totals. A view query must join a published binding first, then authorize that binding before snippets, counts, facets, or pagination are exposed.
- The public viewer document list resolves only room-owned folders and documents. Preview and download use a room-scoped document lookup and `LinkPolicy`. These routes cannot accept a library document ID directly.
- Share links currently scope to one room, folder, or document. The export worker receives a room ID and optional room-owned document or folder IDs. Both need view-aware resource identities and authorization at execution time.

## Proposed additive data model

| Entity                                         | Purpose                                                                               | Key constraints                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Room.mode`                                    | `INDEPENDENT` or `COMPANY_VIEW`                                                       | Immutable after room creation in the first release. Existing rooms default to `INDEPENDENT`.                                   |
| `LibraryFolder`                                | Organization-owned canonical tree                                                     | Organization-scoped path uniqueness, parent in same organization, soft archive.                                                |
| `LibraryDocument` and `LibraryDocumentVersion` | Canonical identity, metadata, scan state, version history and file/preview references | One organization; version chain and scan gate remain authoritative. Never infer access from a library ID alone.                |
| `RoomViewFolder`                               | Room-local placement and ordering for a library folder                                | Room must be `COMPANY_VIEW`; organization and parent must match. A binding can be hidden without archiving the library folder. |
| `RoomViewDocument`                             | Published library document in a room folder                                           | Unique active placement per room and library document; explicit `publishedVersionId`, publish status, timestamps, and actor.   |
| View-aware link scope                          | Link targets a room-view folder or document binding                                   | A link cannot target an unbound library item. Mode-specific scope fields and database constraints prevent mixed targets.       |

The first implementation should use new library tables and a shared service for scan, preview, and file retrieval. It should not retrofit independent documents into the library in the same migration. A later consolidation can be evaluated with real usage and a separate migration plan.

## Single authorization rule

Every operation resolves `(organization, room, active binding, published version, actor or viewer link)` inside an organization-scoped transaction. Authorization must deny if the room is inactive, the binding is unpublished, the version is not clean or otherwise servable, or the actor lacks the required room and resource permission. The response must be indistinguishable for an absent item and an item hidden from that audience.

| Surface                                        | Required change before release                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room tree and document list                    | Return only published bindings and approved folder placement; counts exclude hidden items.                                                                     |
| Search                                         | Join bindings before returning title, snippet, total, suggestions, or facets; authorize each candidate before pagination.                                      |
| Preview, thumbnail, and download               | Resolve through the room-view binding on every request, including historical versions and storage URLs.                                                        |
| Public links and viewer sessions               | Scope to view binding IDs, recheck active binding and published version on every serve, and reject stale sessions after unpublish.                             |
| Export                                         | Validate at request and worker execution; freeze an authorized binding/version manifest, record omissions, and prevent hidden files from entering the archive. |
| Q&A, bookmarks, messages, analytics, and audit | Record both canonical document ID and room-view binding ID, while keeping viewer-facing activity room-specific.                                                |
| Webhooks and notifications                     | Describe publication and unpublication as room events without leaking another audience's document title.                                                       |

## Customer workflow

1. A publisher creates a Company View Room, chooses an audience label and starter structure, and sees an empty draft view.
2. The publisher selects library folders or individual documents and sees a preview of what that room's viewers will see. Newly selected items are drafts until published.
3. The publish screen shows exact version, destination room, folder path, link scope, and any existing viewers or links. It requires an explicit publish action.
4. The room displays a visible `Company library view` label. Library management shows where each item is published. `Remove from this room` and `Archive from company library` are separate actions.
5. A new canonical version prompts publishers to review affected views. No audience receives it automatically in the first release.

## Delivery sequence and proof

1. Add the schema and deny-by-default binding resolver behind a feature flag. Establish organization RLS and foreign-key checks that prevent cross-organization bindings.
2. Implement library upload, scan, preview, and version history. Keep it visible only to library administrators.
3. Implement a draft Company View Room and a read-only published tree. Test one document in two rooms with different versions and audiences.
4. Route member search, preview, download, public links, and export through the binding resolver. Add a permission matrix for allowed, denied, revoked, archived, scanning, and stale-link cases. Include cross-tenant and cross-view tests for snippets, counts, files, and archive contents.
5. Add publish/unpublish UI, impact preview, audit, and support diagnostics. Run a controlled test organization with overlapping Investor, Board, M&A, and Compliance views before a customer pilot.

Release gates include a zero-leak authorization matrix, correct version pinning, archive impact confirmation, accessible keyboard/mobile publish workflow, and a reversible feature flag. No automatic migration of existing documents or links is part of the first release.

## Three-pass review

- **Strawman:** Copy documents into each audience room. This is acceptable for a deliberate independent snapshot but creates divergent versions and unclear revocation for a live company library.
- **Steelman:** Canonical library versions with explicit per-room publication bindings, pinned versions, and one authorization resolver preserve a single source while keeping each audience boundary visible and testable.
- **Premortem:** A new version could appear in the wrong audience, a search snippet could reveal an unpublished document, a stale link could serve a removed binding, or an export worker could include content after revocation. Explicit version release, binding-first queries, serve-time checks, and worker-time manifest validation are mandatory controls.

## Decisions to settle before implementation

- Which roles may upload to the library, publish to a room, and archive canonical content?
- Should a document be placed once or multiple times within one room view? The proposed first release allows one active placement per room.
- Should some organizations opt into automatic version follow after a pilot? The recommended first release pins versions.
- What retention and legal-hold rules govern a library item still referenced by room views?

## References

- `docs/ROOM_VIEWS_AND_STARTER_FOLDERS_DESIGN_2026-09-02_v1.md`
- `prisma/schema.prisma`
- `src/app/api/search/route.ts`
- `src/app/api/view/[shareToken]/documents/route.ts`
- `src/app/api/view/[shareToken]/documents/[documentId]/download/route.ts`
- `src/lib/permissions/LinkPolicy.ts`
- `src/app/api/rooms/[roomId]/export/route.ts`
