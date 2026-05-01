# VaultSpace Room Navigation And Folder Depth Guidance (v3)

**Date:** 2026-04-30
**Status:** Stakeholder Direction For Lead Dev — Revised
**Supersedes:** `ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v2.md` (which superseded v1)
**Scope:** Room browsing model, split-pane behavior, folder-depth policy, enforcement, and persistence

---

## Revision Notes (v3)

This revision tightens v2 in three places where v2 left product behavior either content-dependent or ambiguous. Material changes:

1. Default view mode is now a single deterministic rule. The v2 content-aware heuristic (8 top-level folders, 4 subfolders) is removed. First visit always defaults to grid; the user's chosen mode is remembered thereafter.
2. View-mode and pane-open state are now persisted per-room, not globally. A choice in the diligence room does not bleed into the marketing room.
3. Bulk import behavior is a single rule: reject-with-report. The v2 "flatten or reject" optionality is removed.

Earlier revisions (v1 → v2) raised the folder depth cap from 1 to 2 subfolder levels (depth 3 from room) and added the Enforcement section. Those decisions are preserved unchanged in v3.

---

## Executive Direction

VaultSpace should borrow from Finder and File Explorer without turning into a literal file manager clone.

The right product move is:

- Keep the current documents-first room canvas.
- Introduce a desktop-friendly split-pane browsing mode where it improves orientation.
- Preserve the current content-first grid experience for scan-and-browse workflows.
- Enforce a shallow folder hierarchy so rooms stay understandable and do not degrade into mini file systems.

The intent is familiarity without bloat. Users should benefit from a recognizable folder-navigation pattern, but VaultSpace must still feel like a focused virtual data room, not a general-purpose operating system shell.

---

## Product Position

VaultSpace is not only a file browser. It is a room-based document review product with:

- sharing and external viewer flows
- access and confidentiality controls
- room-scoped administration
- structured document review tasks

Box, Dropbox Business, and SharePoint document libraries are the relevant peer comparators. Each is a broad collaboration environment that exposes deep folder trees, persistent left navigation, and general-purpose file operations. VaultSpace is deliberately narrower: a curated review environment scoped to a deal, audit, fundraise, or other discrete event. The interaction patterns we adopt from those products should reduce friction in document navigation only; we should not adopt their persistent management chrome.

The correct standard is:

- use familiar file-navigation patterns where they improve usability
- avoid importing persistent chrome that competes with the document surface
- keep the room centered on the current document collection, not on the mechanics of navigating folders

---

## Recommendation

### 1. Use A Split-Pane Pattern Selectively

Adopt a folders-left, content-right model as a supported room-browsing mode for desktop and wide screens.

This should not replace the current room universally. It should be introduced where it is most useful:

- primarily in list view
- primarily on desktop or wide tablet widths
- as a collapsible navigation aid, not as mandatory permanent chrome

This is the best balance between familiarity and focus.

### 2. Do Not Force A Finder Clone Everywhere

Do not make the room feel like a full operating-system file manager.

Specifically:

- do not add a dense left tree in every mode by default
- do not use the left pane for non-folder features
- do not move room management, sharing, Q&A, checklist, or other secondary surfaces into the folder rail
- do not let the split-pane pattern reintroduce the clutter that was just removed from the room canvas

The left pane should exist only to help people move through folder hierarchy.

### 3. Preserve Two Different Browsing Modes

VaultSpace should support two legitimate ways of working:

- List mode: better for hierarchy, scanning metadata, and file-manager familiarity
- Grid mode: better for visual scan, thumbnails, and lightweight browsing

The split-pane pattern belongs naturally to list mode first. Grid mode should remain more immersive and content-led.

### 4. Default View-Mode Selection

Default view-mode rules are deterministic and content-independent:

- First visit to any room defaults to grid mode.
- Once the user explicitly picks a view mode in a given room, that choice is remembered for that room and is used on subsequent visits.
- View-mode preference is scoped per-room, not globally. A choice in one room does not affect any other room.
- The list-mode toggle in the toolbar carries a one-time tooltip the first time the user lands in a folder-heavy room, briefly describing what list mode adds. The tooltip dismisses on first interaction and does not change the default.

Discoverability of split-pane is delivered through the toggle and its tooltip, not through invisible content-driven switching. The same room must always present the same way to a first-time visitor regardless of how its content evolves.

---

## Why This Is The Right Direction

### Familiarity Helps

Many users already understand:

- a left navigation region for folders
- a right content region for the current folder
- visible current selection
- expandable folder hierarchy
- breadcrumbs for path context

That familiarity lowers cognitive load and reduces training needs.

### But Literal Emulation Would Be A Mistake

VaultSpace rooms are not personal hard drives. They are curated review environments.

If the product leans too far into OS-style file management, the risk is:

- too much persistent navigation chrome
- less emphasis on the actual document surface
- more visual density
- more complicated mobile adaptation
- more room for users to create messy structures that are hard to govern

The goal is to borrow the useful interaction pattern, not inherit the whole operating-system paradigm.

---

## Proposed Interaction Model

### Core Layout

On supported widths in list mode:

- Left pane: folder tree only
- Right pane: files and immediate subfolders in the selected folder
- Top of content pane: breadcrumb, room title/context, and document commands

### Folder Pane Rules

The left pane should:

- show only folders
- show clear current selection
- support expand/collapse for folders that contain subfolders
- remain narrow and utilitarian
- be collapsible

The left pane should not:

- contain room-level admin features
- duplicate top-level global navigation
- become a second app shell
- be resizable in Phase 1 (fixed width, see Sizing below)

### Sizing

- Pane width is a fixed 280px on desktop. No drag-to-resize in Phase 1.
- Resizing is reconsidered only if Phase 2 telemetry shows users repeatedly attempting the divider, or the user research surfaces it.
- Rationale: a resizable splitter introduces non-trivial keyboard accessibility work (`aria-valuenow`, arrow-key resize, focus management) that is disproportionate to its Phase 1 value.

### Content Pane Rules

The right pane should:

- continue to be the main work surface
- show files and immediate child folders for the selected node
- preserve current sort, selection, and metadata behaviors
- retain the existing inline command toolbar model

### Mobile And Narrow Width Behavior

On narrower widths, the split-pane should collapse cleanly. Do not force a two-column layout where it causes truncation or crowding.

Concrete breakpoint rules (Tailwind tokens):

- Below `lg` (less than 1024px): folder pane is hidden by default. A toggle in the toolbar reveals it as a slide-in drawer over the content pane.
- At `lg` (1024px) and above: folder pane is visible by default whenever list mode is active and the user has not explicitly collapsed it for that room.
- Breadcrumbs are always visible regardless of pane state, so users always know location even when the tree is hidden.

---

## Folder Hierarchy Policy

### Recommended Policy

A maximum of two subfolder levels beneath a top-level folder.

In plain terms:

- room
- top-level folder
- mid-level subfolder
- leaf-level subfolder
- files

No deeper hierarchy than that. Maximum folder depth from the room is **3** (top + mid + leaf).

That means:

- top-level folders are allowed
- top-level folders may contain mid-level subfolders
- mid-level subfolders may contain leaf-level subfolders
- leaf-level subfolders may not contain additional folders
- files are allowed at any of the three folder levels and at the room root

### Why Depth 3 (Two Subfolder Levels)

The depth cap exists to prevent folder sprawl, not to forbid useful structure. Real diligence rooms (see `SEED_DATA.md`, Series A Funding Room) commonly use three-level taxonomies:

```
Financials / 2025 / Q3 / cash-flow.pdf
Legal / Contracts / Customer / msa-acme.pdf
HR / Employees / Departed / severance-jdoe.pdf
```

A one-subfolder cap forces flattening such as `Legal_Contracts_Customer` or 30+ top-level folders, which trades depth for naming bloat without solving the underlying organization problem. Depth 3 covers an estimated 95%+ of real M&A, fundraise, and audit taxonomies. Depth 4+ is where rooms degrade into mirrors of someone's local drive.

### Why The Cap Still Matters

#### 1. It Preserves Clarity

Deep hierarchies feel manageable while being built, but they quickly become difficult to navigate and explain to other people.

In a VDR context, users should understand the room structure quickly. A shallow hierarchy improves:

- information scent
- wayfinding
- onboarding for new viewers
- recoverability when people get lost

#### 2. It Prevents Taxonomy Drift

Without a hard limit, teams tend to keep nesting folders instead of making cleaner structural decisions.

That produces:

- inconsistent naming
- ambiguous ownership of documents
- folders that mirror internal org charts rather than reviewer needs
- rooms that become archives instead of curated workspaces

#### 3. It Keeps Room Design Intentional

If a room needs many branches and sub-branches beyond depth 3, that is often a sign that:

- the room is trying to do too many jobs
- the information should be split into clearer top-level areas
- a separate room may be warranted

The folder rule becomes a governance tool, not just a UI constraint.

#### 4. It Simplifies Viewer Experience

External viewers and occasional users benefit from simple room structures.

A shallow tree reduces:

- getting lost in navigation
- empty or redundant intermediary folders
- excessive clicking before reaching the relevant document set

#### 5. It Lowers Product Complexity

A hard depth limit makes many things simpler over time:

- tree rendering
- expand/collapse behavior
- breadcrumb logic
- move operations
- testing
- analytics and audit interpretation

#### 6. It Scopes Future Permission Inheritance Cleanly

Today, folder permissions inherit from the room (MVP behavior). The V1 roadmap includes folder-scoped permission overrides (`F-PERM-FOLDER`). When that ships, permission resolution must walk from the file up to the room and merge any overrides along the way. At depth 3, the resolution path is bounded and the UX for explaining "why does this user see this file" remains tractable. At depth 5+, that explanation becomes unmanageable for most reviewers.

This doc's depth cap is a load-bearing assumption for the future folder permission UX. Any future request to deepen the hierarchy must be evaluated against the permission-resolution UX at the same time.

---

## Enforcement

The depth cap is a hard product rule, not UI guidance. It is enforced at every layer that can create or move a folder.

### API

- `POST /api/rooms/:roomId/folders` rejects creation with HTTP 400 and error code `FOLDER_DEPTH_EXCEEDED` if the parent folder is already at depth 3.
- `PATCH /api/rooms/:roomId/folders/:folderId` (move operation) rejects with the same error code if the move would place the folder or any of its descendants at depth 4 or beyond.

### Bulk Import

Bulk import paths (drag-folder-upload, ZIP import) reject any folder path that would place a folder at depth 4 or beyond. There is no flatten-on-import behavior.

The import response includes a per-path report listing each rejected entry with its source path and reason, so the caller can decide how to reorganize before retrying. The import is treated as a single atomic operation: if any path is rejected, the entire import is rolled back and nothing is created. This forces the user to make a deliberate organizational decision rather than letting the importer silently lose taxonomy.

A future opt-in flag (`flattenOnDepthExceeded`) may be considered if real usage shows the reject-and-retry loop is frequent and painful, but it is explicitly out of scope for Phase 1.

### Database

No schema-level constraint is added; depth is computed from the parent chain. A Prisma middleware or service-layer guard performs the check on every folder mutation. Tenant isolation is unaffected.

### UI

- Folder create dialog disables the "create subfolder" affordance when the current folder is at depth 3, with inline copy explaining the limit.
- The error response from the API is surfaced as a toast that points the user toward the recovery options below.
- Bulk import surfaces the per-path rejection report inline in the import dialog, not as a generic error.

### Recovery Copy

When a user hits the depth cap, the UI offers three explicit alternatives:

- Create another top-level folder.
- Reorganize the current folder's children to flatten the structure.
- Create a new room if the content is materially separate (different audience, lifecycle, or confidentiality).

This is the same governance language as `## When A New Top-Level Room Is Better` and should be reused verbatim where space allows.

---

## Recommended Structural Rule

Use this policy unless there is a later, explicit product decision to change it.

### Allowed

- Room
- Top-level folder
- Mid-level subfolder
- Leaf-level subfolder
- Files at the room root or at any folder level

### Not Allowed

- Folder depth of 4 or more
- Subfolders inside leaf-level subfolders
- Chains of organizational nesting that mimic local drive structures

### Product Guidance

If a user believes they need a deeper branch, they should do one of the following instead:

- create another top-level folder
- reorganize the folder naming and grouping
- create a new room if the content represents a distinct workstream, audience, or confidentiality boundary

---

## When A New Top-Level Room Is Better

A new room is preferable when the content differs materially in one or more of these ways:

- different audience
- different confidentiality rules
- different lifecycle or deadline
- different workflow owner
- different external sharing pattern

A room should not become a catch-all container just because folders make it technically possible. The platform should encourage separation when the work itself is meaningfully separate.

---

## Persistence Of User Preferences

### Phase 1 (this implementation)

User preferences are persisted in `localStorage`, scoped per-room. No backend work in Phase 1.

Keys:

- `vaultspace:room:{roomId}:viewMode` — `"grid"` or `"list"`
- `vaultspace:room:{roomId}:folderPaneOpen` — `"true"` or `"false"`

Rationale:

- Per-room scoping reflects the document's premise that split-pane is selectively useful. A user who prefers list+pane in a folder-heavy diligence room should not have that bleed into a flat marketing-collateral room.
- localStorage avoids any backend work for Phase 1 and ships with the UI change.
- First visit to any room (no key present) always falls through to the deterministic default in `Recommendation §4`: grid mode.

Tradeoff: preferences do not follow the user across devices or browsers. This is acceptable in Phase 1; revisit if usage data shows it matters.

### Phase 3 (future)

If usage data shows users frequently switching devices and resetting their preference, migrate to server-side persistence:

- new column on `UserOrganization`: `roomViewPreferences JSONB` (keyed by room id)
- new endpoint: `PATCH /api/users/me/preferences`
- on login, hydrate localStorage from server values

Defer this work until there is evidence the cross-device gap matters.

---

## UX Guardrails For Lead Dev

If this split-pane model is implemented, keep these guardrails.

### Do

- make the folder pane clearly secondary to the content pane
- keep breadcrumbs even when the folder tree is visible
- use strong selection styling so current location is obvious
- let users collapse the pane
- remember the user's chosen browsing mode per-room (per the Persistence section)
- keep the command toolbar with the content, not in the left rail

### Do Not

- turn the left pane into a catch-all navigation area
- permanently reduce content width on small screens
- introduce more than two subfolder levels
- add more controls to "justify" the pane
- let the pattern regress into old admin-heavy layout behavior
- vary the default view mode based on room content

---

## Suggested Rollout Sequence

### Phase 1

Introduce split-pane browsing in list view on desktop widths with:

- collapsible left folder pane (fixed 280px)
- current-folder highlight
- breadcrumb preserved at all times
- depth-3 folder rendering only
- depth cap enforced in API, UI, and bulk import paths (reject-with-report on import)
- view-mode and pane-open state persisted in localStorage, scoped per-room
- first visit defaults to grid; the user's chosen mode is remembered per-room thereafter
- one-time tooltip on the list-mode toggle for discoverability

### Phase 2

Evaluate whether users actually prefer it for high-folder rooms.

Check:

- navigation speed
- comprehension
- whether users keep the pane open
- whether deeper hierarchy requests continue or diminish
- whether users attempt to drag the pane edge (signal for resizable)
- whether bulk import rejection rate suggests a future opt-in flatten flag is worth the work

### Phase 3

Only after real usage data:

- consider resizable pane behavior
- consider making split-pane the default for list mode
- consider server-side preference persistence
- consider opt-in flatten-on-depth-exceeded flag for bulk import
- do not expand folder depth unless there is strong evidence and a separate governance decision

---

## Acceptance State

This document becomes contract once the items below are checked. Until then, it is direction.

- [ ] Lead Dev acceptance of folder depth cap at 3
- [ ] Lead Dev acceptance of Phase 1 scope as written
- [ ] API spec updated with `FOLDER_DEPTH_EXCEEDED` error code
- [ ] Database schema review confirms no migration needed (computed depth, no column)
- [ ] UI wireframes updated to show split-pane in list mode
- [ ] Permission model owner reviews Section "It Scopes Future Permission Inheritance Cleanly"
- [ ] Stakeholder sign-off on revised depth cap (raised from 1 in v1 to 2 subfolder levels in v2)
- [ ] Stakeholder sign-off on per-room preference scoping (changed from global in v2 to per-room in v3)
- [ ] Stakeholder sign-off on deterministic grid default and removal of content-aware view-mode heuristic
- [ ] Stakeholder sign-off on reject-with-report as the single bulk import rule

Once all items are checked, downstream documents (`API_SPEC.md`, `UI_WIREFRAMES.md`, `PERMISSION_MODEL.md`) reference this doc as the canonical source for room navigation and folder depth policy.

---

## Final Direction For Lead Dev

Build toward a selective Finder/Explorer-inspired room browser, not a literal clone.

The correct implementation target is:

- split-pane folder navigation in desktop list mode
- collapsible folders-left, files-right pattern at fixed 280px width
- breadcrumbs retained at all times
- management features kept out of the folder pane
- hard folder depth cap of two subfolder levels (depth 3 from room)
- depth cap enforced in API, UI, and import paths with a specific error code
- bulk import rejects depth violations atomically with a per-path report; no silent flattening
- localStorage persistence of view mode and pane state in Phase 1, scoped per-room
- deterministic grid default for first-visit; the user's chosen mode is remembered per-room thereafter
- discoverability of list+pane delivered via a one-time tooltip on the list-mode toggle, not via content-driven defaults

If users need deeper nesting than that, the default product answer should be:

- reorganize the room, or
- create another room

That keeps VaultSpace familiar, governed, and materially easier to use.
