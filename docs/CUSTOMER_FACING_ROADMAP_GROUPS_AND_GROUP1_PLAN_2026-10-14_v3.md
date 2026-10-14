# VaultSpace customer-facing delivery groups and Group 1 implementation review

Date: 2026-10-14 PDT  
Status: Implementation candidate. Version 3 supersedes the planning conclusions in versions 1 and 2. Production verification is pending release.

## Delivery sequence

| Group                                  | Customer outcome                                                                  | Next gate                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Clear and trustworthy room workflow | Room, sharing, document, and Trash controls describe what the platform does.      | Release and browser walkthrough.                             |
| 2. Reliable activity notices           | Members receive durable in-app notices for ordinary uploads and supported events. | Review producer, retry, recipient, and deduplication design. |
| 3. Document preview quality            | Uploaded formats preview reliably with clear fallbacks.                           | Run a live format matrix before adding infrastructure.       |
| 4. Reusable organization setup         | Organizations maintain their own folder templates.                                | Set ownership, revision, and conflict rules.                 |
| 5. Company Content Library             | Canonical documents publish into authorized room views.                           | Set publisher, version, search, retention, and scope rules.  |
| 6. Customer domain onboarding          | Organizations use verified domains and certificates.                              | Set an ingress and certificate operating model.              |

## Group 1 contract

An external document download is allowed only when the room allows downloads, the share link grants download permission, and the document allows downloads. Turning room downloads off immediately blocks downloads through existing links. Turning the setting back on restores only downloads still allowed by the link and document. Viewer list, document detail, and version-history responses now report that effective state. The file endpoint applies the room cap before document lookup, counters, audit, or storage reads.

Share-link cards distinguish a download grant paused by room settings from a currently usable grant. The create-link dialog explains this condition before submission. Revoking a link is labeled as revocation because the endpoint deactivates the link and its active viewer sessions.

Document expiry fields were stored without a document-expiry executor. The properties dialog no longer offers new automatic scheduling; the metadata endpoint rejects non-null expiry settings, while existing values remain stored and visible as inactive. The Trash page and API no longer calculate or advertise permanent-deletion deadlines when no cleanup process is active. This change does not purge Trash or modify historical expiry values.

Category, tags, and link-permission controls now have associated labels. Guidance text is connected to the relevant controls where it changes a decision. Essential restrictions appear as visible text, not only in a hover affordance.

## Evidence and limits

- Red-first regression tests reproduced the room download mismatch in the file endpoint and both viewer availability responses.
- The download permission matrix covers room off, view-only link, document denial, allowed downloads, and historical versions. Focused API tests cover version-history flags, Trash response shape, and rejection of unsupported new expiry settings.
- Rendered component tests find the permission, category, and tags controls by accessible name and check that the paused-room and inactive-expiry guidance is exposed.
- The full Vitest suite passed: 203 files and 1,787 tests, with 1 file and 7 tests skipped by their existing configuration. Type check, lint, and production build passed. Lint reported three existing warnings in the users page outside this group.
- Browser, keyboard, touch, screen-reader, and live admin-to-viewer checks remain release verification. The unit and component tests do not prove these input-mode combinations.

## Review

**Strawman:** Add explanations to the old controls without changing authorization. This would leave downloads possible in rooms labeled view only and keep unsupported expiry promises visible.

**Steelman:** Enforce the effective policy in the file endpoint, derive viewer state from the same inputs, and put concise consequences beside the admin controls. Keep existing expiry data but stop accepting schedules that cannot execute. This is the implemented approach.

**Premortem:** A stale client may still show a download control after the room setting changes, but the server gate returns 403. A room that re-enables downloads may activate old link grants, so the settings copy and paused-link state call out that consequence. Existing expiry fields may be mistaken for active automation; table badges and properties copy mark them inactive. A signed storage URL issued by a separate authorized flow may have its own expiration and is outside the external viewer route contract. Cross-browser and assistive-technology failures could remain until the release walkthrough is completed.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUPS_AND_GROUP1_PLAN_2026-10-14_v2.md`
- `src/app/api/view/[shareToken]/documents/[documentId]/download/route.ts`
- `src/app/api/view/[shareToken]/documents/route.ts`
- `src/app/api/view/[shareToken]/documents/[documentId]/route.ts`
- `src/app/api/view/[shareToken]/documents/[documentId]/versions/route.ts`
- `src/app/api/rooms/[roomId]/documents/[documentId]/route.ts`
- `src/app/api/rooms/[roomId]/trash/route.ts`
- `src/app/(admin)/rooms/[roomId]/_components/CreateLinkDialog.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/ManageDrawer.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/EditPropertiesDialog.tsx`
- `src/app/(admin)/rooms/[roomId]/trash/page.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/roomGuidance.test.tsx`
