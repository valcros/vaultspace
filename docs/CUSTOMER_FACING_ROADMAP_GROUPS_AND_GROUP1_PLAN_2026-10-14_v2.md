# VaultSpace customer-facing delivery groups and Group 1 review

Date: 2026-10-14 PDT  
Status: Planning and code review, version 2. No product code or production configuration changes are authorized by this document.

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

In scope: room list and room detail state labels; share-link creation and management; member and access controls; room settings; document action and properties dialogs; the existing `ContextHelp` behavior; keyboard, touch, screen-reader, and cross-browser QA for these surfaces. The external viewer is included where a changed label or setting affects what it sees. The room download setting has a code-level policy mismatch and requires a separately reviewed authorization correction within this group if the recommended hard-cap contract is accepted.

Out of scope: broad permission-model redesign, implementing new room lifecycle transitions, a global help center, notification delivery, new preview formats, organization templates, and Company Content Library work. A misleading lifecycle control may require a small safety correction or a separately reviewed implementation dependency.

### Evidence from the code review

- `ContextHelp` already provides hover/focus help plus click/tap access using Radix Tooltip and Popover. Existing room-status and add-folder explanations use it, with end-to-end coverage for hover, keyboard, dismissal, and touch.
- The create-link dialog offers View Only, View & Download, password, expiry, and session limit. Its permission label targets `linkPermission`, but the Select trigger has no matching ID in the reviewed component. This is an accessibility defect to verify in the rendered accessibility tree and correct if confirmed.
- The document properties dialog has labels without explicit control associations for category, tags, expiry date, and expiry action. It says the document will auto-archive or delete after its date.
- The repository records `expiresAt` and `expiryAction`, but the current worker search found no document-expiry executor. The backlog and job specification say generic expiry and trash cleanup are not implemented. The Trash page also promises permanent deletion after the retention period, while older deleted documents remain listed. These are customer-visible claims requiring a lifecycle truth check before adding further explanatory text.
- Room settings already has visible descriptions for download, version history, NDA, confidentiality, and IP allowlist. This pass should improve unclear consequences and effective-state summaries, not add an icon beside every control.
- The share-link list shows View Only or View & Download, password, email requirement, disabled or pending state, and expiry. The creation flow should explain the effective access outcome before a link is created or its permission is broadened.
- The room setting `allowDownloads` is persisted, but the reviewed external-viewer download route checks the link permission and document `allowDownload` without checking `room.allowDownloads`. The viewer document-list response also reports `downloadEnabled` from the link permission alone. A room marked View-Only in settings can therefore still present and serve downloads through a View & Download link when the document permits them. This is a code-level finding that needs an end-to-end reproduction before release.

### Preliminary truth table

| Surface and current message                                                        | Implemented behavior found                                                                                                                              | Review action                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Room status help: Draft, Live, Archived, Closed                                    | Centralized status text exists and room/link policy checks active state.                                                                                | Confirm each transition in an admin and viewer walkthrough; retain accurate copy.                                                                                                          |
| Room setting: `Allow Original Downloads`, described as permitting viewer downloads | `allowDownloads` is stored, but the external-viewer list and download route derive availability from the link and document instead.                     | Decide policy, then make the server gate and UI show the same effective result. Recommended policy: room must allow downloads, link must grant download, and document must allow download. |
| Share link: `View & Download`                                                      | Link permission is required for the external download route; document permission can still deny it.                                                     | Explain that the displayed link permission is one layer of the effective policy.                                                                                                           |
| Document properties: automatic archive or delete after expiry date                 | Expiry fields are stored; no document-expiry executor was found in the current worker code, and the backlog marks generic expiry cleanup unimplemented. | Remove the unqualified promise and prevent misleading new scheduling, or prioritize a separately reviewed lifecycle implementation. Preserve existing stored values.                       |
| Trash: permanent deletion after 30 days                                            | The page computes a deadline, but the scheduled trash cleanup is marked unimplemented; older items remain visible.                                      | Correct the claim and plan retention enforcement separately. Do not purge historical trash as part of this UI group.                                                                       |
| Create link and document property form labels                                      | Some Select triggers and inputs lack explicit matching label/control IDs in the reviewed components.                                                    | Verify accessibility-tree names and connect labels and hints where missing.                                                                                                                |

### Proposed work packages

1. **Truth and terminology audit.** Complete the preliminary table for each status label, help sentence, setting description, and confirmation. Reproduce the room-download mismatch with a disposable room and link. Record expiry and Trash retention as unimplemented until runtime evidence proves otherwise. Resolve each mismatch through an explicit product or implementation decision, with no silent change to stored values.
2. **Sharing and access contract.** Decide whether the room setting is a hard cap or merely a default. The recommended contract is a hard cap: effective download requires room, link, and document permission. If accepted, apply the gate at the external download endpoint and make viewer UI and admin summaries reflect it. Add concise guidance for link permission, expiry, email requirement, and revocation consequences. Test existing links when the room setting is changed.
3. **Settings and document-action clarity.** Show effective current state and consequences for high-impact settings. Link labels and hints to their controls. Keep irreversible or access-changing warnings visible in the confirmation or form, not only in a tooltip.
4. **Accessible interaction pass.** Reuse the existing Radix help component. Verify Escape dismissal, focus return, hover persistence, touch operation, no nested interactive controls, descriptive names, and adequate touch targets. Avoid a new `interestfor` or anchor-positioning stack because it has limited Firefox and Safari support and would add polyfills to an existing working pattern.
5. **Validation and closeout.** Add focused automated tests only for behavior changed by this group. Run manual keyboard and screen-reader checks, Chrome/Firefox/Safari desktop checks, mobile touch and 200% zoom checks, and a small admin-to-viewer sharing scenario. Reconcile issue #93 only after confirming its existing regression passes.

### Acceptance criteria

- Every Group 1 guidance statement is traceable to implemented behavior; no active control promises an unscheduled automatic action.
- The server and UI agree on effective download permission. Under the recommended contract, turning off room downloads blocks existing and new View & Download links without revoking their access to view. Re-enabling the room setting restores only downloads still allowed by the link and document.
- An admin can tell whether a link permits downloads, whether another room restriction still applies, and what a permission change affects before committing it.
- Form controls in the reviewed dialogs have programmatic names, associated hints, and visible validation errors.
- All help can be opened with keyboard and touch, dismissed with Escape, and exited without lost focus. Essential warnings remain visible without opening help.
- The affected admin and viewer flows pass focused automated checks and recorded manual QA on the supported browsers and input modes. Any unsupported combination is documented rather than implied to work.
- The download authorization correction receives focused security review and link/room/document permission-matrix tests. No retention or notification behavior changes are bundled into a copy-only patch.

### Review framework

**Strawman:** Add help icons throughout the app with longer explanatory copy. This is fast but can hide critical restrictions, clutter the interface, and repeat unsupported claims.

**Steelman:** Put the consequence next to high-stakes controls, keep short supplemental help for optional detail, and derive wording from verified policy. Reuse the existing help component and test the complete admin-to-viewer journey. This is the recommended design.

**Premortem:** A room could say View-Only while an old link still downloads a document; a UI-only fix could hide the button while the endpoint remains open; a document expiry promise could never execute; a screen reader could announce unlabeled Select controls; a touch user could miss a hover-only warning; a permission change could be mistaken for link revocation. Server-side effective-policy checks, truthful visible state, explicit control associations, and end-to-end role tests are release gates.

### Implementation order and review gates

1. Complete the surface-by-surface truth table and reproduce the download-policy mismatch. Decide the intended room/link/document rule. Do not write new UI copy until the lifecycle discrepancies have an owner decision.
2. If the hard-cap rule is accepted, correct the external download gate and viewer availability response first, then update sharing and access forms. Review permission-matrix tests and effective-policy examples before merging.
3. Improve settings and document dialogs, including label associations and verified retention wording.
4. Run the focused automated and manual QA matrix. Review screenshots and accessibility-tree output for desktop and mobile.
5. Release the group as one or more small PRs with a final product walkthrough. Track any backend lifecycle work separately if the truthful UI requires it.

### Decisions to resolve during the first work package

- For existing document expiry settings, should the UI display them as pending and prevent new scheduling until enforcement exists, or should lifecycle enforcement be brought forward as a separate project? The current copy should not remain as an unqualified promise.
- Should `allowDownloads=false` be a hard room-wide cap? This review recommends yes, because the current settings label says it governs viewer downloads. A weaker default-only interpretation would require renaming and redesigning the setting and explaining why existing links can still download.
- What are the supported manual QA combinations for launch? Proposed minimum: Chrome plus VoiceOver/Safari on macOS, Firefox keyboard, and a 390 px touch viewport; add NVDA/Windows when an approved tester or runner is available.
- For existing View & Download links in a room whose download setting is disabled, should the link card show `Downloads paused by room` while retaining its underlying link grant? This review recommends that explicit state.

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
- `src/app/api/view/[shareToken]/documents/route.ts`
- `src/app/api/view/[shareToken]/documents/[documentId]/download/route.ts`
- `src/lib/permissions/LinkPolicy.ts`
- `src/providers/preview/GotenbergPreviewProvider.ts`
- `src/components/documents/TextPreviewRenderer.tsx`
- Modern Web Guidance: `interest-triggered-tooltips` and `accessibility` guides, retrieved 2026-10-14
- Merged PRs #205 through #211; open issue #93
