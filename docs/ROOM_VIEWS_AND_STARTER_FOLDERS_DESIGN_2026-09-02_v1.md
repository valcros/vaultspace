# Room Views and Starter Folders Design

Date: 2026-09-02

## Approved delivery boundary

Phase 1 delivers selectable, deselectable starter-folder structures for **independent data rooms**. It creates folders only. It does not copy documents, alter permissions, or make a folder available in another room.

The product must continue to distinguish two future room modes:

1. **Independent Data Room**: room-owned folders and documents, appropriate for isolated deals, client workspaces, or buyer-specific diligence.
2. **Company View Room**: an audience-specific view over a future organization-level Company Content Library, appropriate for recurring Investor, Board, M&A, or Compliance audiences.

No existing room will be migrated automatically. There is no shared-content behavior in Phase 1.

## Phase 1 contract

- Templates are optional. A user can create an empty room.
- Selecting a template initially selects all its folders.
- Users may select or deselect any parent or child folder.
- Selecting a child automatically includes its parent path.
- Deselecting a parent deselects descendants.
- The server accepts only paths that belong to the selected template and reconstructs required parents defensively.
- Existing-room application creates selected folders at the room root. It rejects the entire request if any selected path already exists, preventing a partial tree.
- Templates are structure-only. No document, share link, permission, or audience assignment is created.
- Both room creation and starter-folder application leave one audit event with the template identifier and the created-folder count. The current event taxonomy records this as `ROOM_CREATED` or `ROOM_UPDATED`; a dedicated folder-blueprint event remains a Phase 2 audit-schema decision.

## Future Company View Room contract

The shared-content design requires additive entities, not a many-to-many shortcut on the current `Folder` table:

```text
Organization
  Company Content Library
    Canonical folders and documents
  Company View Rooms
    Room-to-library folder bindings, room-local ordering, and audience permissions
  Independent Rooms
    Existing room-owned folders and documents
```

A canonical document must pass the specific room-view authorization check before it is listed, searched, previewed, downloaded, exported, or linked. Removing an item from one view must never archive it from the library. Library archive must show all affected views and require a privileged confirmation.

## Review record

### Strawman

Copying the same folders and documents into Investor, Board, M&A, and Compliance rooms would be smaller, but creates divergent versions and audit ambiguity. Rejected for shared-company-material workflows. It remains valid only when a user explicitly asks for an independent snapshot.

### Steelman

A canonical Company Content Library plus audience-specific room views supports one version history, deliberate disclosure, retention controls, and overlapping folders. Adopted as the Phase 2 direction while retaining independent rooms.

### Pre-mortem safeguards

- Wrong-audience exposure: deny by default, explicit view bindings, access-matrix integration tests.
- Hidden-file search leakage: authorize before search results are returned, not only at download.
- Accidental cross-view deletion: separate `Remove from this room` and `Archive from company library` operations.
- User confusion over copies: explicit labels for shared library, private room folder, and copied structure.
- Risky migration: no automatic migration, opt-in organization conversion only after feature-flagged tests.

### Security review

Existing folder, document, permission, and link checks are room-scoped. Phase 1 preserves those boundaries and therefore adds no cross-room authorization surface. Phase 2 must redesign share links, preview/download routes, search, exports, and audit projections together before shared content is enabled.

### UX review

The UI must state that starter structures add folders only, offer an empty room, permit full deselection, and make parent selection rules visible through the tree. The existing-room option is labeled `Starter Folders` so it is distinguishable from `New Folder`.

## Phase 2 entry criteria

- Approved canonical-library data model and migration plan.
- Complete role and route permission matrix.
- Explicit semantics for publish, unpublish, copy, remove from view, move, and archive.
- Search, previews, downloads, exports, and share links proven isolated per audience view.
- Controlled test organization with overlapping Investor, Board, M&A, and Compliance views.
