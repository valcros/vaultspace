# Group 2: reliable activity notices, implementation review

Date: 2026-10-14 PDT
Status: Implementation candidate. Version 2 supersedes version 1. Production verification is pending release.

## Customer contract

An ordinary document upload or folder import creates an in-app notice for each active administrator of the room, except the uploader. The notice is scoped to the recipient's active organization membership. A multi-file folder import creates one room notice for the batch. Q&A answers and access requests retain their existing event and notice transactions.

The upload record, audit event, and in-app notice now commit together. If the notice cannot be stored, the transaction fails, the API reports an upload error, and the newly written storage object is cleaned up. A process exit after the commit cannot lose an in-app notice. If the transaction body finishes but the database commit response is uncertain, the storage object is retained for review so cleanup cannot remove a potentially committed document. Email notification jobs remain separate and do not control the in-app result.

The notification store has a unique key on membership and source event. Replaying a producer call for the same event skips duplicate notices. The inbox continues to require the current active membership, and its list and read-state queries remain scoped to that membership and organization.

## Review

**Strawman:** Retry the previous post-commit notification call. This still loses a notice if the process exits before the call or the retry is exhausted. It can also return upload success while the member inbox is missing the event.

**Steelman:** Commit the audit event and recipient notices inside the upload transaction. Use the event ID as the deduplication key. Preserve the existing recipient rules and batch notice behavior. Return an upload error when the notice cannot commit, with cleanup of the upload's uncommitted storage object.

**Premortem:** A notification database failure now fails an upload instead of silently losing the notice. The API's per-file error response must make this clear. A cleanup failure can leave an orphaned blob and is logged for operations; it does not hide the original upload error. An ambiguous database commit also retains the blob and logs the uncertainty, favoring review over deleting a potentially committed object. The existing scan and email jobs are queued after the database commit and retain their separate delivery behavior. This group does not backfill historical missing notices or guarantee email delivery.

## Verification

- Red-first tests reproduced the silent-success behavior for ordinary uploads and folder imports.
- Focused tests cover event and notice ordering, failure propagation and storage cleanup, uncertain commit preservation, one notice for a multi-file import, active administrator selection, actor exclusion, and duplicate suppression through the store's unique key.
- Type, lint, format, build, full suite, CI, and staging checks are release gates and will be recorded after completion.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUPS_AND_GROUP1_PLAN_2026-10-14_v3.md`
- `docs/CUSTOMER_FACING_ROADMAP_GROUP2_REVIEW_2026-10-14_v1.md`
- `src/services/DocumentService.ts`
- `src/lib/rooms/folderImportService.ts`
- `src/services/notifications/InAppNotificationService.ts`
- `src/app/api/users/me/notification-inbox/route.ts`
- `prisma/schema.prisma`
