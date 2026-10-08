# VaultSpace Room Navigation And Folder Depth Guidance

**Date:** 2026-04-30  
**Status:** Stakeholder Direction For Lead Dev  
**Scope:** Room browsing model, split-pane behavior, and folder-depth policy

---

## Executive Direction

VaultSpace should **borrow from Finder and File Explorer without turning into a literal file manager clone**.

The right product move is:

- Keep the current **documents-first room canvas**.
- Introduce a **desktop-friendly split-pane browsing mode** where it improves orientation.
- Preserve the current **content-first grid experience** for scan-and-browse workflows.
- Enforce a **shallow folder hierarchy** so rooms stay understandable and do not degrade into mini file systems.

The intent is familiarity without bloat. Users should benefit from a recognizable folder-navigation pattern, but VaultSpace must still feel like a focused virtual data room, not a general-purpose operating system shell.

---

## Product Position

VaultSpace is not only a file browser.

It is a room-based document review product with:

- sharing and external viewer flows
- access and confidentiality controls
- room-scoped administration
- structured document review tasks

Because of that, the interface should not blindly reproduce Finder or Windows Explorer. Those products are broad file-management environments. VaultSpace needs only the parts of that mental model that reduce friction for document navigation.

The correct standard is:

- use familiar file-navigation patterns where they improve usability
- avoid importing persistent chrome that competes with the document surface
- keep the room centered on the current document collection, not on the mechanics of navigating folders

---

## Recommendation

### 1. Use A Split-Pane Pattern Selectively

Adopt a **folders-left, content-right** model as a supported room-browsing mode for desktop and wide screens.

This should not replace the current room universally. It should be introduced where it is most useful:

- primarily in **list view**
- primarily on **desktop or wide tablet widths**
- as a **collapsible** navigation aid, not as mandatory permanent chrome

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

- **List mode:** better for hierarchy, scanning metadata, and file-manager familiarity
- **Grid mode:** better for visual scan, thumbnails, and lightweight browsing

The split-pane pattern belongs naturally to **list mode** first.

Grid mode should remain more immersive and content-led.

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

- **Left pane:** folder tree only
- **Right pane:** files and immediate subfolders in the selected folder
- **Top of content pane:** breadcrumb, room title/context, and document commands

### Folder Pane Rules

The left pane should:

- show only folders
- show clear current selection
- support expand/collapse for folders that contain subfolders
- remain narrow and utilitarian
- be collapsible
- be optionally resizable on desktop if implementation cost is acceptable

The left pane should not:

- contain room-level admin features
- duplicate top-level global navigation
- become a second app shell

### Content Pane Rules

The right pane should:

- continue to be the main work surface
- show files and immediate child folders for the selected node
- preserve current sort, selection, and metadata behaviors
- retain the existing inline command toolbar model

### Mobile And Narrow Width Behavior

On narrower widths, the split-pane should collapse cleanly.

Do not force a two-column layout where it causes truncation or crowding.

Preferred behavior:

- hide the folder pane by default on narrow widths
- reveal it with an explicit control
- preserve breadcrumbs so users always know location even when the tree is hidden

---

## Folder Hierarchy Policy

### Recommended Policy

I support a **maximum of one subfolder level beneath a top-level folder**.

In plain terms:

- room
- top-level folder
- one nested subfolder
- files

No deeper hierarchy than that.

That means:

- top-level folders are allowed
- folders may contain one level of child folders
- child folders may contain files
- child folders may **not** contain additional folders

This is the right policy for VaultSpace.

### Why A One-Subfolder Limit Is Good

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

If a room needs many branches and sub-branches, that is often a sign that:

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
- permission inheritance reasoning
- analytics and audit interpretation

Even if VaultSpace does not yet expose all of that complexity, it is better to set the governance model early.

---

## Recommended Structural Rule

Use this policy unless there is a later, explicit product decision to change it:

### Allowed

- Room
- Top-level folder
- Single child subfolder
- Files at either level

### Not Allowed

- Subfolder inside subfolder
- Folder depth of 3 or more
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

A room should not become a catch-all container just because folders make it technically possible.

The platform should encourage separation when the work itself is meaningfully separate.

---

## UX Guardrails For Lead Dev

If this split-pane model is implemented, keep these guardrails:

### Do

- make the folder pane clearly secondary to the content pane
- keep breadcrumbs even when the folder tree is visible
- use strong selection styling so current location is obvious
- let users collapse the pane
- remember the user’s chosen browsing mode
- keep the command toolbar with the content, not in the left rail

### Do Not

- turn the left pane into a catch-all navigation area
- permanently reduce content width on small screens
- introduce more than one subfolder level
- add more controls to “justify” the pane
- let the pattern regress into old admin-heavy layout behavior

---

## Suggested Rollout Sequence

### Phase 1

Introduce split-pane browsing in **list view on desktop widths** with:

- collapsible left folder pane
- current-folder highlight
- current breadcrumb preserved
- top-level folder plus one-subfolder rendering only

### Phase 2

Evaluate whether users actually prefer it for high-folder rooms.

Check:

- navigation speed
- comprehension
- whether users keep the pane open
- whether deeper hierarchy requests continue or diminish

### Phase 3

Only after real usage data:

- consider resizable pane behavior
- consider making split-pane the default for list mode
- do not expand folder depth unless there is strong evidence and a separate governance decision

---

## Final Direction For Lead Dev

Build toward a **selective Finder/Explorer-inspired room browser**, not a literal clone.

The correct implementation target is:

- split-pane folder navigation in desktop list mode
- collapsible folders-left, files-right pattern
- breadcrumbs retained
- management features kept out of the folder pane
- hard folder depth cap of **one subfolder level**

If users need deeper nesting than that, the default product answer should be:

- reorganize the room, or
- create another room

That keeps VaultSpace familiar, governed, and materially easier to use.
