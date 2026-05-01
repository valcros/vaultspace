# VaultSpace Room Navigation Phase 1 Sprint Plan

**Date:** 2026-04-30  
**Status:** Drafted from approved room navigation guidance  
**Primary source of truth:** `docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md`

---

## Sprint Objective

Ship a desktop-friendly, Finder/Explorer-inspired room browsing model for list mode without regressing the documents-first room experience.

At the end of the sprint:

- the room still opens in grid mode by default
- list mode supports an optional folders-left, files-right split pane on desktop
- folder depth is capped at 3 from room root
- room navigation preferences are remembered per-room
- folder-preserving import paths reject atomically when any path exceeds the depth cap

---

## Product Outcome

Users should be able to:

- browse folder-heavy rooms using a familiar left-tree/right-content model
- move between grid and list mode intentionally
- stay oriented through breadcrumbs and clear active selection
- understand the folder-depth rule before or at the moment they hit it

This sprint is a navigation and governance sprint. It is not a new admin-surface sprint.

---

## Non-Goals

Not in Phase 1:

- making the split pane the universal default
- reintroducing room tabs, stat rows, or heavy admin chrome
- resizable pane behavior
- folder-specific permissions UI
- deep folder drag-and-drop redesign
- server-side persistence of room navigation preferences
- changing the public viewer IA

---

## Current Baseline In Code

Frontend:

- Room page orchestration lives in `src/app/(admin)/rooms/[roomId]/page.tsx`.
- View mode is currently stored globally in `localStorage` under `vaultspace-doc-view`.
- Compact density and visible columns are also currently browser-global.
- Breadcrumbs and folder navigation already exist in a single-surface model.

Backend:

- `src/app/api/rooms/[roomId]/folders/route.ts` supports `GET` and `POST`.
- `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts` supports `GET`, `PATCH`, and `DELETE`.
- Current folder APIs do not enforce the new depth contract.
- `src/components/documents/UploadZone.tsx` captures folder paths from drag-and-drop, but the upload API currently ignores those paths and uploads into the current `folderId`.

This sprint should build on that baseline rather than replacing it wholesale.

---

## Scope Summary

### In Scope

- Split-pane shell in room `list` mode at `lg+`
- Mobile folder drawer for list mode below `lg`
- Folder tree component with keyboard support
- Per-room localStorage for view mode and desktop pane-open state
- One-time list-mode discoverability tooltip
- Folder depth guard for create and move operations
- Atomic reject-with-report contract for folder-preserving imports
- Updated API contract and QA coverage

### Out Of Scope

- Resizable splitters
- New room-level analytics dashboards
- Public viewer folder tree
- Folder drag-and-drop reordering UI
- Server-side preference sync
- Expanding allowed folder depth beyond `3`

---

## Stories And Tickets

### RN-01: Split-Pane Room Shell

**Type:** Frontend  
**Priority:** P0

**User story:** As an admin in a folder-heavy room, I want to browse folders from a left tree while keeping documents visible on the right so the room feels familiar and efficient.

**Implementation targets:**

- `src/app/(admin)/rooms/[roomId]/page.tsx`
- likely new components under `src/components/rooms/`

**Acceptance criteria:**

- List mode at `lg+` renders a fixed-width `280px` folder pane and a content pane.
- Grid mode does not show the persistent folder pane.
- Breadcrumbs stay visible above content in all states.
- The inline document toolbar remains in the content pane.
- The pane can be collapsed and reopened without losing selection state.

### RN-02: Folder Tree Component

**Type:** Frontend  
**Priority:** P0

**User story:** As a user navigating nested folders, I want a clear expandable folder tree so I can move through the hierarchy faster than clicking cards alone.

**Implementation targets:**

- `src/components/rooms/RoomFolderTree.tsx`
- optional `RoomFolderTreeItem.tsx`

**Acceptance criteria:**

- Tree shows folders only.
- Current folder is visibly selected.
- Expand/collapse affordance is distinct from row selection.
- Tree supports keyboard navigation with ARIA tree semantics.
- Breadcrumb and tree selection stay in sync.

### RN-03: View Mode, Pane State, And Tooltip Persistence

**Type:** Frontend  
**Priority:** P0

**User story:** As a returning user, I want each room to remember how I browse it so I do not keep reconfiguring the same workspace.

**Implementation targets:**

- room page state initialization and persistence logic
- optional small hook such as `useRoomNavigationPreferences`

**Acceptance criteria:**

- First visit to any room defaults to `grid`.
- `vaultspace:room:{roomId}:viewMode` stores room-specific mode.
- `vaultspace:room:{roomId}:folderPaneOpen` stores room-specific desktop pane state.
- Mobile drawer open state is not persisted.
- One-time tooltip near the list toggle can be dismissed and does not auto-switch modes.

### RN-04: Folder Depth Guard Service

**Type:** Backend / shared logic  
**Priority:** P0

**User story:** As the system, I need to enforce the folder-depth rule consistently so rooms stay governed no matter how folders are created or moved.

**Implementation targets:**

- new helper under `src/lib/rooms/` or `src/services/rooms/`
- folder create and update flows

**Acceptance criteria:**

- Shared depth helper computes folder depth from parent chain.
- Shared subtree helper computes max descendant depth for moves.
- Create beyond depth `3` fails with `FOLDER_DEPTH_EXCEEDED`.
- Move beyond depth `3` fails with `FOLDER_DEPTH_EXCEEDED`.
- Existing valid create/rename behaviors remain intact.

### RN-05: Folder API Contract Update

**Type:** Backend  
**Priority:** P0

**User story:** As the frontend, I need precise API responses for create, move, and import errors so the room UI can guide users cleanly.

**Implementation targets:**

- `src/app/api/rooms/[roomId]/folders/route.ts`
- `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts`
- related tests

**Acceptance criteria:**

- `POST /folders` returns `400 FOLDER_DEPTH_EXCEEDED` when parent depth is already `3`.
- `PATCH /folders/:folderId` supports rename, move, or both.
- Move into descendant is rejected with `400 INVALID_INPUT` or equivalent explicit error.
- All depth-cap failures include `maxDepth`, `attemptedDepth`, and `operation`.

### RN-06: Folder-Preserving Import Guard

**Type:** Backend / upload pipeline  
**Priority:** P1

**User story:** As an admin importing a folder structure, I want a clear all-or-nothing result so the system does not silently mangle my hierarchy.

**Implementation targets:**

- upload/import service path parsing
- document upload route if path-aware import is exposed in this sprint
- inline reporting contract

**Acceptance criteria:**

- Any import path that requires depth `4+` causes the whole import to fail.
- No folders or documents from that request are created.
- The failure returns a per-path rejection report.
- There is no flatten-on-import behavior in Phase 1.

**Implementation note:**

Current `UploadZone` already captures folder paths, but the document upload API ignores them. Lead Dev must choose one of these explicit approaches and document the choice in the PR:

- fully wire path-aware import in Phase 1, or
- implement the backend contract and parser scaffolding while keeping UI path import behind current behavior

Do not silently leave the contract half-implemented.

### RN-07: Room Visual Integration Pass

**Type:** Frontend  
**Priority:** P1

**User story:** As a user, I want the new pane to feel like part of the improved room canvas rather than a bolted-on white modal.

**Acceptance criteria:**

- Folder rail reads as a secondary utility surface.
- Active selection uses the current accent language.
- Split pane does not reintroduce heavy top chrome.
- Grid mode remains calm and documents-first.

### RN-08: Accessibility And Regression Hardening

**Type:** Frontend + QA  
**Priority:** P0

**User story:** As a keyboard and assistive technology user, I need the new navigation model to remain usable without a mouse.

**Acceptance criteria:**

- Tree meets basic ARIA tree interaction expectations.
- Mobile drawer returns focus to opener on close.
- Tooltip is keyboard-dismissible.
- Manage drawer, dock puck, and existing room actions still behave correctly.

---

## Design And UX Requirements

- The room remains documents-first.
- The left pane is for folders only.
- `Manage room` remains separate from the folder tree.
- The pane must never feel like a second global navigation shell.
- Grid mode remains the simpler first-visit experience.
- The tooltip teaches; it must not coerce or auto-switch.

---

## Technical Deliverables

The Lead Dev should produce or update the following alongside implementation:

- `UI_WIREFRAMES.md` addendum for split-pane layouts and states
- `API_SPEC.md` addendum for `FOLDER_DEPTH_EXCEEDED`, move semantics, and import contract
- `docs/ROOM_NAVIGATION_PHASE1_TECHNICAL_DESIGN.md`
- `QA_TEST_PLAN.md` addendum for split-pane and depth-cap coverage

---

## Analytics And Success Metrics

### Success metrics

Track these as the first indicators of whether the split-pane model is helping:

- percentage of room sessions that switch from grid to list
- percentage of list-mode sessions that keep the pane open
- rate of repeated pane-open usage in the same room
- number of depth-cap failures per active room
- number of import rejections due to depth

### Recommended client telemetry events

If a product analytics sink or abstraction is available during implementation, emit:

- `room_view_mode_changed`
- `room_folder_pane_toggled`
- `room_folder_selected`
- `room_list_mode_tooltip_dismissed`
- `room_depth_cap_hit`
- `room_import_depth_rejected`

Suggested event properties:

- `roomId`
- `organizationId`
- `fromMode`
- `toMode`
- `paneOpen`
- `folderDepth`
- `rejectionCount`

If no client analytics sink exists, do not invent a large telemetry subsystem in this sprint. Instead:

- keep the event spec in the PR notes
- rely on QA/manual observation for launch
- treat real instrumentation as a follow-up if the team wants product telemetry

---

## Accessibility Requirements

- ARIA tree semantics for the folder pane
- keyboard traversal with arrow keys
- visible focus ring on pane toggle, tree rows, and list/grid toggle
- focus return from mobile drawer
- tooltip accessible name/description path
- no hover-only critical behavior

These are definition-of-done items, not optional polish.

---

## Rollout And Migration Behavior

### Existing rooms

- No data migration is required for rooms that already fit the new depth cap.
- Existing rooms continue to open in grid mode for first-time visitors.
- Existing folder structures remain browsable.

### Existing over-deep data

If any legacy room already contains depth `4+` data from old behavior or manual inserts:

- do not block rendering of existing structure
- do block any new create or move that would deepen or extend the invalid branch
- record the condition in QA and raise it explicitly in the PR notes

### Browser preference migration

- Old key: `vaultspace-doc-view`
- New key: `vaultspace:room:{roomId}:viewMode`

Phase 1 recommendation:

- do not migrate the old global key
- start fresh with per-room semantics
- this avoids surprising cross-room carryover from the old behavior

### Rollout strategy

1. Ship behind normal staging review first.
2. Validate desktop list mode, mobile drawer, and folder-depth failures on staging.
3. Confirm no regression to manage drawer, dock puck, upload, breadcrumb, or folder delete flows.
4. Release to production only after QA addendum sign-off.

---

## Definition Of Done

- All P0 stories accepted
- API contract updated in repo
- UI spec updated in repo
- QA addendum updated in repo
- Automated tests added for depth create/move rules and preference persistence
- Manual QA completed for desktop and mobile room navigation
- Lead Dev PR includes before/after screenshots for:
  - room grid default
  - room list mode with pane open
  - room list mode with pane collapsed
  - mobile folder drawer
  - depth-cap error state

---

## Recommended Sprint Sequence

1. Land shared depth helper and folder API contract.
2. Add room preference model and list/grid deterministic default.
3. Build folder tree UI and desktop split pane.
4. Add mobile drawer behavior.
5. Wire tooltip and visual integration pass.
6. Finish import guard path if included in the sprint branch.
7. Run QA addendum and staging review.
