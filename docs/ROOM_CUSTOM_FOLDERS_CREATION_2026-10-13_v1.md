# Room-specific folders at creation: design review

Date: 2026-10-13
Scope: Create empty, room-owned folders alongside a selected standard folder template during room creation. The standard template remains unchanged.

## Strawman

Let an organization admin enter a folder name and choose its parent from the selected template folders or previously added custom folders. Show the resulting tree before creation. Send the custom folder names and parent paths with the template selection. Resolve the template revision, validate the combined structure, then create the room and all folders in the existing transaction.

## Steelman

Reuse the established template picker, depth limit, and transactional folder writer. A parent selector avoids asking customers to type paths. Allow an empty template choice so a room can start with only custom folders. Validate the same limits on the server, since browser controls can be bypassed. Keep the custom additions in the room creation request only, so no shared template record changes. An audit event records template and custom folder counts.

## Premortem

- A deselected template parent leaves a custom child orphaned. Remove dependent custom rows when the parent is deselected and reject stale or forged parents on the server.
- A new name collides with a selected template folder or another custom sibling. Check sibling names without regard to case and check paths before any room write.
- A nested custom folder exceeds the room depth limit or creates an oversized tree. Enforce depth three and a total folder cap on both paths through the request.
- A changed template revision produces a different preview from the saved room. Continue requiring the exact template revision and return the existing conflict response.
- A partial folder write leaves a misleading room. Resolve and validate the complete tree before room creation, and use the existing organization-scoped transaction for all writes.

## Verification

Exercise a selected template with root and nested custom additions, a custom-only room, invalid parent/depth/collision requests, and stale template revisions. Run type checking, targeted tests, lint, and a production build. Inspect the final create-room controls for labels, keyboard reachability, status text, and a clear combined preview.
