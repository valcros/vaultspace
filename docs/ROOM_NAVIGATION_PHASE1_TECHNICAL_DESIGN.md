# VaultSpace Room Navigation Phase 1 Technical Design

**Date:** 2026-04-30  
**Status:** Implementation design derived from approved guidance  
**Primary source of truth:** `docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md`

---

## Purpose

This document translates the approved room navigation guidance into concrete implementation decisions for the current codebase.

It is intentionally narrower than a general architecture document. It focuses on:

- room page state and layout behavior
- folder depth enforcement
- preference persistence
- import validation semantics
- testing and regression risks

---

## Current Baseline

### Frontend

The room page is already documents-first in:

- `src/app/(admin)/rooms/[roomId]/page.tsx`

Current relevant behavior:

- `viewMode` is stored globally in `localStorage` under `vaultspace-doc-view`
- list and grid are already supported
- breadcrumb state is local to the room page
- folders and documents are already fetched separately
- folder navigation is currently breadcrumb + single content surface

Existing browser-global room preferences still in the page:

- `vaultspace-doc-view`
- `vaultspace-compact`
- `vaultspace-columns`

### Backend

Folder APIs already exist:

- `src/app/api/rooms/[roomId]/folders/route.ts`
- `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts`

Current limitations:

- no depth-cap enforcement
- `PATCH /folders/:folderId` currently behaves as rename only
- no explicit `FOLDER_DEPTH_EXCEEDED` error contract

### Upload/import path

`src/components/documents/UploadZone.tsx` already captures dropped folder paths using `webkitGetAsEntry()`, but those paths are not currently passed through the upload API in a way that creates or validates folder hierarchy. The current comment in `UploadZone` explicitly states backend folder auto-creation is not implemented.

This gap matters because the guidance document now defines contract behavior for folder-preserving imports.

---

## Implementation Overview

Phase 1 should be implemented as a layered change:

1. shared folder-depth rules
2. folder API enforcement
3. room UI state model
4. folder tree UI
5. responsive pane/drawer behavior
6. optional path-aware import plumbing if the team includes folder-preserving upload in this sprint

---

## Proposed Frontend Structure

### Keep orchestration in the room page

Retain `src/app/(admin)/rooms/[roomId]/page.tsx` as the orchestrator for:

- room fetch
- documents fetch
- folder fetch
- toolbar actions
- breadcrumb state
- dialogs

Do not split the page so aggressively that the current room behavior becomes hard to follow.

### Extract focused room-navigation components

Recommended new components:

- `src/components/rooms/RoomFolderTree.tsx`
- `src/components/rooms/RoomFolderTreeItem.tsx`
- `src/components/rooms/RoomFolderDrawer.tsx`

Recommended hook:

- `src/components/rooms/useRoomNavigationPreferences.ts`

Recommended shared helpers:

- `src/lib/rooms/navigationPreferenceKeys.ts`
- `src/lib/rooms/folderDepth.ts`

These names fit the repo’s current pattern better than creating a large standalone module.

---

## Frontend State Model

### Existing state to keep

- `currentFolderId`
- `breadcrumbs`
- `viewMode`
- `visibleColumns`
- `compact`

### New or revised state

- `folderPaneOpenDesktop: boolean`
- `folderDrawerOpenMobile: boolean`
- `listModeHintVisible: boolean`
- `expandedFolderIds: Set<string>`

### Persistence rules

Persist per-room:

- `vaultspace:room:{roomId}:viewMode`
- `vaultspace:room:{roomId}:folderPaneOpen`

Persist globally:

- `vaultspace:room:listModeHintDismissed`

Keep existing keys unchanged in Phase 1:

- `vaultspace-compact`
- `vaultspace-columns`

Rationale:

- the guidance document only changes room navigation preference scope
- compact density and visible column preferences still behave like user-level table preferences
- changing all preference scoping in one sprint would create unnecessary migration noise

### Important behavior decision

`folderPaneOpenDesktop` only applies at `lg+`.

Below `lg`:

- `folderDrawerOpenMobile` is transient UI state
- it is never restored from localStorage on page load

This avoids the bad mobile experience of auto-opening a drawer because the user left a desktop pane open in the same room.

---

## Deterministic Default Rules

On room mount:

1. Read `vaultspace:room:{roomId}:viewMode`
2. If not present, default to `grid`
3. If mode resolves to `list`:
   - at `lg+`, read `vaultspace:room:{roomId}:folderPaneOpen`
   - if no key is present, default to `true`
4. Below `lg`, always start with mobile drawer closed

Tooltip rule:

- evaluate whether the room is “folder-heavy enough” to justify the hint
- if yes, and `vaultspace:room:listModeHintDismissed` is absent, show the tooltip near the list toggle

Concrete threshold recommendation:

- show the tooltip only when at room root and either:
  - there are at least `4` root folders, or
  - any visible root folder has `childCount > 0`

This threshold is for discoverability only. It must not change the default mode.

---

## Folder Tree Data Model

The room page currently fetches folders for one parent level at a time. For the tree, Phase 1 has two reasonable implementation options.

### Option A: Lazy-load per expansion

Pros:

- smaller initial payload
- easiest to layer onto current API

Cons:

- more request chatter
- more loading states within the tree

### Option B: Fetch all folders in room once for list mode

Pros:

- simple tree rendering
- easy expand/collapse logic
- easier breadcrumb/tree synchronization

Cons:

- larger initial payload

Recommendation:

Use **Option B** unless room sizes prove it problematic. The depth cap of `3` bounds hierarchy complexity, and the current product is not yet operating at a scale where a whole-room folder tree is obviously dangerous.

If Option B is chosen:

- add a non-breaking way to fetch all folders for the room
- either via a query param on `GET /folders`
- or via a dedicated tree endpoint if the team wants strict separation

Preferred Phase 1 path:

- `GET /api/rooms/:roomId/folders?tree=1`

Response should include:

- `id`
- `name`
- `parentId`
- `path`
- `depth`
- `childCount`
- `documentCount`

---

## Breadcrumb Synchronization

The room page already treats breadcrumbs as canonical path state.

Phase 1 rule:

- selecting a node in the tree rebuilds breadcrumbs from that node’s ancestry
- clicking a breadcrumb selects the matching tree node

Implementation recommendation:

- build an in-memory `Map<string, FolderNode>`
- compute ancestry by walking `parentId`
- derive breadcrumbs from the selected node instead of mutating them optimistically in multiple places

This is safer than pushing breadcrumb entries manually and later trying to reconcile them with the tree.

---

## Folder Depth Enforcement Design

### Shared helper

Create a small shared helper, for example:

- `src/lib/rooms/folderDepth.ts`

Suggested exports:

- `getFolderDepth(path: string): number`
- `getProposedChildDepth(parentPath: string | null): number`
- `validateFolderCreateDepth(parentPath: string | null, maxDepth = 3): void`
- `validateFolderMoveDepth(folderPath: string, destinationParentPath: string | null, descendantPaths: string[], maxDepth = 3): void`

### Why use path-based depth

The current folder model already stores `path`, for example:

- `/Financials`
- `/Financials/2025`
- `/Financials/2025/Q3`

That means depth can be computed without adding a schema column. Path parsing is enough for Phase 1.

### Move validation algorithm

For a move:

1. Load source folder and destination parent
2. Reject move into self or descendant
3. Compute destination depth for the moved node
4. Compute the maximum relative depth of the moved subtree
5. If `destinationDepth + subtreeRelativeDepth > 3`, reject with `FOLDER_DEPTH_EXCEEDED`
6. If valid, update moved folder path and descendant paths inside one transaction

---

## API Changes

### `POST /folders`

Add before create:

- room permission check remains as-is
- if `parentId` exists, fetch parent folder
- compute new depth from parent path
- reject with `FOLDER_DEPTH_EXCEEDED` if new depth would be `4`

### `PATCH /folders/:folderId`

Current behavior is rename only. Phase 1 should explicitly allow:

- rename
- move
- rename + move

Suggested request handling:

- if `parentId` is present, treat as re-parent request
- if `name` is present, use it for resulting path
- if neither is present, return `400`

### Error shape normalization

Current folder routes return mixed shapes such as:

- `{ success: false, error: { message } }`
- `{ error: 'message' }`

Phase 1 should normalize folder-depth failures to the documented shape in `API_SPEC.md`.

Do not spend this sprint rewriting every existing route response in the app. Limit normalization to the paths touched by this feature unless that work is trivial.

---

## Import / Upload Path Design

### Current reality

`UploadZone` captures per-file `path`, but the upload route only accepts:

- `file`
- `folderId`
- `tags`

No folder-preserving import contract is currently honored.

### Phase 1 decision point

Lead Dev must explicitly choose one path and document it in the PR:

#### Path A: Full folder-preserving import in Phase 1

- extend upload payload to include per-file relative paths
- pre-validate all paths
- create missing folders transactionally
- upload documents only if path validation succeeds for the whole batch

#### Path B: Contract-first implementation in Phase 1

- add shared import path validator and response contract
- keep existing upload UI behavior unchanged
- document that folder-preserving import UI remains deferred

Because the guidance doc explicitly mentions drag-folder-upload and ZIP import, **Path A is preferable** if the sprint can absorb it. If not, Path B must be made explicit so the team does not imply support that the product does not actually provide.

### Recommendation

For this codebase, Path B is safer unless the team is intentionally expanding upload scope. The current upload route is service-driven and stable; forcing folder auto-creation into the same sprint increases risk materially.

---

## Suggested UI Composition

At `lg+` in list mode:

- page header stays as-is
- room identity plane stays as-is
- below toolbar, render:
  - left tree rail
  - right content pane

Do not move toolbar controls into the left rail.

Recommended component structure inside the room page:

```tsx
<RoomIdentityPlane />
{viewMode === 'list' ? (
  <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
    {showFolderPane && <RoomFolderTree ... />}
    <RoomDocumentListPane ... />
  </div>
) : (
  <RoomDocumentGridPane ... />
)}
```

Below `lg`:

- keep content full width
- open tree as sheet/drawer using the existing sheet pattern already added to the repo

---

## Accessibility Details

Tree requirements:

- `role="tree"` on container
- `role="treeitem"` on node rows
- `role="group"` for child collections
- `aria-expanded` on expandable nodes
- `aria-selected` on current node

Focus requirements:

- selecting from the tree does not steal focus into the content pane automatically
- closing mobile drawer returns focus to the opener
- tooltip can be dismissed with keyboard

---

## Existing-Data And Migration Behavior

### No schema migration

No database migration is required for Phase 1.

### Existing localStorage

Do not migrate `vaultspace-doc-view`.

Reason:

- it encodes global behavior the product is intentionally abandoning
- migrating it would reintroduce cross-room bleed by accident

### Existing over-depth room structures

If legacy data contains depth `4+`:

- render it if encountered
- block new invalid create/move operations
- log the condition in QA and PR notes

The sprint should not include a cleanup migration unless one is separately approved.

---

## Testing Strategy

### Unit tests

Add unit tests for:

- depth parsing
- create validation
- move validation
- descendant/self move rejection

### Route tests

Add route tests for:

- `POST /folders` success at depth 1, 2, 3
- `POST /folders` reject at depth 4
- `PATCH /folders/:folderId` rename only
- `PATCH /folders/:folderId` valid move
- `PATCH /folders/:folderId` invalid move due to depth

### Component tests

Add focused tests for:

- per-room viewMode persistence
- per-room pane-open persistence
- list/grid deterministic default
- tooltip dismissal behavior

### Manual QA

Use the addendum in `QA_TEST_PLAN.md`.

---

## Risks

### Medium risk: state complexity in the room page

The room page already carries many responsibilities. Adding split-pane state directly into the page can become brittle if helper extraction is skipped.

Mitigation:

- extract preference and tree logic into small helpers/components

### Medium risk: move-path bugs

Path rewrites for rename + move are easy to get wrong for descendants.

Mitigation:

- write shared move helper
- test descendant path rewrites explicitly

### Medium risk: implying import capability the product does not actually support

The guidance document mentions import semantics, but current upload code does not yet implement folder-preserving import.

Mitigation:

- choose Path A or Path B explicitly in the sprint PR

---

## Recommended File-Level Work Plan

Frontend:

- modify `src/app/(admin)/rooms/[roomId]/page.tsx`
- add `src/components/rooms/RoomFolderTree.tsx`
- optionally add `src/components/rooms/RoomFolderDrawer.tsx`
- add `src/components/rooms/useRoomNavigationPreferences.ts`

Backend:

- modify `src/app/api/rooms/[roomId]/folders/route.ts`
- modify `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts`
- optionally modify `src/app/api/rooms/[roomId]/documents/route.ts` if Path A is chosen
- add `src/lib/rooms/folderDepth.ts`

Tests:

- add folder API route tests
- add helper unit tests
- add room-page preference tests if the team’s current test setup supports them

---

## Final Recommendation

Keep the implementation disciplined:

- enforce the depth rule once in shared logic
- keep split-pane behavior confined to room list mode
- preserve the room’s documents-first hierarchy
- do not turn this sprint into a broad file-manager rewrite

If the Lead Dev follows this document plus the sprint plan and updated UI/API/QA docs, they should have enough detail to execute without inventing product behavior mid-stream.
