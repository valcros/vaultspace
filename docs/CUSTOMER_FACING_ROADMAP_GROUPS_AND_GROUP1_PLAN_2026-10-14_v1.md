# VaultSpace customer-facing delivery groups and Group 1 review

Date: 2026-10-14 PDT  
Status: Planning and review. No product code or production configuration changes are authorized by this document.

## Current baseline

The October 9 backlog predates the October 13 and 14 merges. Room-specific folders, folder-preserving import, the member-scoped notification inbox, mobile viewer navigation coverage, and closed-room disclosure have merged. The viewer Back action has an end-to-end regression test and folder-context implementation even though issue #93 remains open. Treat these as verification or tracker-closeout items, not new feature work.

The document preview plan is also historical. The repository already has a Gotenberg provider, a text preview renderer, and Gotenberg configuration for Docker Compose and Azure. Group 3 must first test live format behavior and identify actual gaps before proposing more conversion infrastructure.

## Delivery groups

| Group                                      | Customer outcome                                                                                                                                                             | Bounded deliverable                                                                                                                | Main dependency                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Clear and trustworthy room workflow** | Admins understand room state, sharing, access, settings, and document actions before making decisions. Keyboard, touch, and screen-reader users can reach the same guidance. | Content audit, targeted inline guidance, accessible help behavior, and manual QA of affected workflows.                            | Verify every explanation against current authorization and lifecycle behavior.                                                                     |
| **2. Reliable activity notices**           | Members receive expected in-app notices after ordinary uploads and other supported events.                                                                                   | Durable delivery design and implementation for the remaining best-effort producer, with recipient, retry, and deduplication tests. | Preserve the member and organization boundaries shipped in #207.                                                                                   |
| **3. Document preview quality**            | Users can preview the formats customers actually upload, with clear fallbacks.                                                                                               | Live format matrix, prioritized rendering fixes, and viewer QA.                                                                    | Reconcile the historical preview plan with the existing Gotenberg and text renderer implementations.                                               |
| **4. Reusable organization setup**         | Organizations can maintain their own folder templates for repeated rooms.                                                                                                    | Organization-owned template authoring, revision handling, and audit UX.                                                            | Tenant ownership and conflict rules; keep system templates separate.                                                                               |
| **5. Company Content Library**             | A canonical document can be deliberately published into audience-specific room views.                                                                                        | Feature-flagged library and publication workflow delivered in independently reviewed stages.                                       | Set publisher roles, version-pinning and retention rules, and prove view-scoped authorization across search, links, preview, download, and export. |
| **6. Customer domain onboarding**          | An organization can use its own domain with a valid certificate and clear setup status.                                                                                      | Self-service or assisted domain claim, DNS validation, certificate provisioning, and failure recovery.                             | Per-tenant ingress and certificate operating model.                                                                                                |

Suggested sequence: complete Group 1, then Group 2 or 3 based on observed customer pain. Group 4 can follow independently. Group 5 is the largest architectural investment. Group 6 should be scheduled when customer demand justifies its operating cost. These are planning groups, not committed release dates.

## Group 1: clear and trustworthy room workflow

### Goal and boundaries

An organization admin should be able to answer five questions at the point of action: What state is this room in? Who can get access? What can a viewer do? What will this setting change? What happens to this document if I use this action?

In scope: room list and room detail state labels; share-link creation and management; member and access controls; room settings; document action and properties dialogs; the existing `ContextHelp` behavior; keyboard, touch, screen-reader, and cross-browser QA for these surfaces. The external viewer is included where a changed label or setting affects what it sees.

Out of scope: changing the permission model, implementing new room lifecycle transitions, a global help center, notification delivery, new preview formats, organization templates, and Company Content Library work. A misleading lifecycle control may require a small safety correction or a separately reviewed implementation dependency.

### Evidence from the code review

- `ContextHelp` already provides hover/focus help plus click/tap access using Radix Tooltip and Popover. Existing room-status and add-folder explanations use it, with end-to-end coverage for hover, keyboard, dismissal, and touch.
- The create-link dialog offers View Only, View & Download, password, expiry, and session limit. Its permission label targets `linkPermission`, but the Select trigger has no matching ID in the reviewed component. This is an accessibility defect to verify in the rendered accessibility tree and correct if confirmed.
- The document properties dialog has labels without explicit control associations for category, tags, expiry date, and expiry action. It says the document will auto-archive or delete after its date.
- The repository records `expiresAt` and `expiryAction`, but the current worker search found no document-expiry executor. The backlog and job specification say generic expiry and trash cleanup are not implemented. The Trash page also promises permanent deletion after the retention period, while older deleted documents remain listed. These are customer-visible claims requiring a lifecycle truth check before adding further explanatory text.
- Room settings already has visible descriptions for download, version history, NDA, confidentiality, and IP allowlist. This pass should improve unclear consequences and effective-state summaries, not add an icon beside every control.
- The share-link list shows View Only or View & Download, password, email requirement, disabled or pending state, and expiry. The creation flow should explain the effective access outcome before a link is created or its permission is broadened.

### Proposed work packages

1. **Truth and terminology audit.** Map each status label, help sentence, setting description, and confirmation to the API and authorization behavior it describes. Record mismatches, especially document expiry and Trash retention. Resolve a mismatch by correcting the UI claim or scheduling a separate implementation, with no silent change to stored values.
2. **Sharing and access clarity.** Add concise visible guidance for link permission, expiry, email requirement, and the difference between room-level and link-level download restrictions. Make permission changes and revocation consequences clear at the action point. Verify actual policy before writing copy.
3. **Settings and document-action clarity.** Show effective current state and consequences for high-impact settings. Link labels and hints to their controls. Keep irreversible or access-changing warnings visible in the confirmation or form, not only in a tooltip.
4. **Accessible interaction pass.** Reuse the existing Radix help component. Verify Escape dismissal, focus return, hover persistence, touch operation, no nested interactive controls, descriptive names, and adequate touch targets. Avoid a new `interestfor` or anchor-positioning stack because it has limited Firefox and Safari support and would add polyfills to an existing working pattern.
5. **Validation and closeout.** Add focused automated tests only for behavior changed by this group. Run manual keyboard and screen-reader checks, Chrome/Firefox/Safari desktop checks, mobile touch and 200% zoom checks, and a small admin-to-viewer sharing scenario. Reconcile issue #93 only after confirming its existing regression passes.

### Acceptance criteria

- Every Group 1 guidance statement is traceable to implemented behavior; no active control promises an unscheduled automatic action.
- An admin can tell whether a link permits downloads, whether another room restriction still applies, and what a permission change affects before committing it.
- Form controls in the reviewed dialogs have programmatic names, associated hints, and visible validation errors.
- All help can be opened with keyboard and touch, dismissed with Escape, and exited without lost focus. Essential warnings remain visible without opening help.
- The affected admin and viewer flows pass focused automated checks and recorded manual QA on the supported browsers and input modes. Any unsupported combination is documented rather than implied to work.
- No authorization, retention, or notification behavior changes are bundled into a copy-only patch without separate review.

### Review framework

**Strawman:** Add help icons throughout the app with longer explanatory copy. This is fast but can hide critical restrictions, clutter the interface, and repeat unsupported claims.

**Steelman:** Put the consequence next to high-stakes controls, keep short supplemental help for optional detail, and derive wording from verified policy. Reuse the existing help component and test the complete admin-to-viewer journey. This is the recommended design.

**Premortem:** A tooltip could say downloads are blocked while a link still permits them; a document expiry promise could never execute; a screen reader could announce unlabeled Select controls; a touch user could miss a hover-only warning; a permission change could be mistaken for link revocation. The truth audit, visible effective-state text, explicit control associations, and end-to-end role checks are release gates.

### Implementation order and review gates

1. Create a surface-by-surface truth table with current wording, actual API behavior, and proposed wording. Do not write new UI copy until the lifecycle discrepancies have an owner decision.
2. Make the smallest changes to sharing and access forms. Review copy and effective-policy examples before merging.
3. Improve settings and document dialogs, including label associations and verified retention wording.
4. Run the focused automated and manual QA matrix. Review screenshots and accessibility-tree output for desktop and mobile.
5. Release the group as one or more small PRs with a final product walkthrough. Track any backend lifecycle work separately if the truthful UI requires it.

### Decisions to resolve during the first work package

- For existing document expiry settings, should the UI display them as pending and prevent new scheduling until enforcement exists, or should lifecycle enforcement be brought forward as a separate project? The current copy should not remain as an unqualified promise.
- What are the supported manual QA combinations for launch? Proposed minimum: Chrome plus VoiceOver/Safari on macOS, Firefox keyboard, and a 390 px touch viewport; add NVDA/Windows when an approved tester or runner is available.
- Which sharing policy summary should be shown when room downloads are disabled but a link has View & Download selected? The existing policy must be verified before wording is finalized.

## Sources

- `BACKLOG.md`, last updated 2026-10-09
- `IMPLEMENTATION_STATUS.md`, last updated 2026-10-08
- `docs/COMPANY_CONTENT_LIBRARY_PHASE2_DISCOVERY_2026-10-13_v1.md`
- `docs/ROOM_VIEWS_AND_STARTER_FOLDERS_DESIGN_2026-09-02_v1.md`
- `DOCUMENT_PREVIEW_PLAN.md`, historical draft
- `QA_TEST_PLAN.md`
- `JOB_SPECS.md`
- `src/components/ui/context-help.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/CreateLinkDialog.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/EditPropertiesDialog.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/ManageDrawer.tsx`
- `src/app/(admin)/rooms/[roomId]/settings/page.tsx`
- `src/providers/preview/GotenbergPreviewProvider.ts`
- `src/components/documents/TextPreviewRenderer.tsx`
- Modern Web Guidance: `interest-triggered-tooltips` and `accessibility` guides, retrieved 2026-10-14
- Merged PRs #205 through #211; open issue #93
