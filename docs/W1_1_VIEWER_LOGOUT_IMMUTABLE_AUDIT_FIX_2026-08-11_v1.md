# W1-1 Viewer Logout and Immutable Audit Fix

- **Date:** 2026-08-11
- **Status:** Analysis complete, implementation authorized after this record is committed
- **Decision owner:** Stakeholder Advisor
- **Control family:** W1-1 viewer-session lifecycle
- **Production baseline during implementation:** W0
- **Deployment status:** Not authorized

## 1. Decision summary

Change viewer-link logout from hard deletion to soft invalidation of the exact active `ViewSession` row. Set `isActive=false` inside the session organization context and retain the session row and all immutable audit events.

The viewer cookie will still be cleared. Subsequent serve requests will fail because `getViewerSessionByToken()` already requires `isActive=true`. No event row, event foreign key, immutability trigger, or schema relation will be changed.

## 2. Observed failure

The CloudVault W1-1 matrix admitted a synthetic viewer, recorded audited activity, and called the viewer logout endpoint. Logout returned an error.

The route currently deletes `ViewSession`. Immutable `Event` rows may reference that session through `events.sessionId`. The foreign key uses `onDelete: SetNull`, so deleting the session asks PostgreSQL to update the referencing event rows. The `events_are_immutable` trigger rejects every event UPDATE and DELETE. The hard delete therefore cannot succeed after audited viewer activity exists.

This is a session-lifecycle correctness failure. It does not justify weakening the immutable audit control.

## 3. Implementation boundary

Authorized files are expected to be limited to:

- `src/app/api/view/[shareToken]/logout/route.ts`
- `src/app/api/view/[shareToken]/logout/route.test.ts`
- `tests/integration/event-immutability.test.ts`
- this analysis record

No schema change, migration, event-trigger change, event deletion, FK redesign, link-admission change, maxViews change, general auth logout change, RLS change, pipeline change, malware behavior, networking change, customer communication, or production deployment is included.

## 4. Detailed design

### 4.1 Resolve the cookie-bound viewer session

Keep the existing `getViewerSession(shareToken, viewerSessionBaseSelect)` lookup. It binds the viewer cookie to an active session and loads the link identity needed to prevent cross-link invalidation.

### 4.2 Soft invalidation

When the resolved session link slug equals the requested share token, run an organization-scoped `viewSession.updateMany()` with all of these predicates:

- exact session id;
- exact organization id;
- `isActive=true`.

Set only `isActive=false`. `updateMany()` makes concurrent duplicate logout requests idempotent and avoids throwing when another request invalidated the same session first.

Do not hard delete the session. Do not null any event, visit, document, or question foreign key. Do not change `lastActivityAt`, because administrative invalidation is not viewer activity.

### 4.3 Cookie and serve behavior

Clear `viewer_${shareToken}` after invalidation. Subsequent requests using a copied pre-logout cookie are rejected because the server-side session lookup filters on `isActive=true`. Client-side cookie removal alone is not considered sufficient.

If no valid matching session is present, preserve idempotent logout behavior by clearing the requested viewer cookie and returning success.

### 4.4 Audit evidence

Existing events remain unchanged and continue to reference the retained inactive session. This preserves the append-only evidence chain. No new logout event type or broad audit schema change is added under this GO.

## 5. Verification plan

### Unit tests

- A matching active session is updated with exact id, organization id, and `isActive=true` predicates.
- The update sets only `isActive=false`.
- The route never calls `viewSession.delete()`.
- The viewer cookie is cleared and the route returns 200.
- A missing or non-matching session still clears the cookie without mutating another session.

### PostgreSQL integration test

Inside a rollback-only transaction:

1. Create a synthetic organization, room, link, and active viewer session.
2. Create an immutable Event referencing that session.
3. Soft-invalidate the session.
4. Assert no active session is returned for the original token.
5. Assert the Event still exists with the same `sessionId` and unchanged description.
6. Allow the outer test transaction to roll back so no immutable test row requires deletion.

This test complements the existing trigger tests that prove direct Event UPDATE and DELETE fail.

### CloudVault after a separate deploy GO

Admit a synthetic viewer, create audited activity, log out, require 200, retry a serve endpoint with the original cookie and require 401, and verify the event remains. Do not use Brightside for this test. Production deployment is not part of this work item.

## 6. Rollback

The change has no migration. Restore the prior web revision if future deployment causes viewer session invalidation or login regressions. Rolling back reintroduces the known audited-viewer logout failure, so W1-1 must remain open.

## 7. Strawman

### What if deleting the session is the desired security behavior?

Hard deletion can appear cleaner because it removes the bearer-token row. In this schema it is incompatible with append-only audit events and is unnecessary for access revocation. An inactive retained session is not accepted by the server and preserves the evidence chain.

### What simpler control achieves most of the reduction?

Clearing only the browser cookie would make the current browser appear logged out, but a copied cookie or replayed token would remain valid server-side. Soft invalidation is the smallest complete control.

### What workflow might break?

- Analytics or cleanup code may have assumed logged-out viewer sessions are deleted.
- A concurrent logout may update zero rows.
- A route that ignores `isActive` could continue serving the retained session.
- Session tables will retain more inactive rows than hard-delete behavior intended.

Current viewer-session lookup already requires `isActive=true`, and the W1-1 link policy tests cover serve denial. Retention growth is an operations concern, not a reason to weaken audit immutability.

### Are we optimizing for an ideal audit model during a single-room Beta?

No. The live CloudVault failure occurs whenever audited viewer activity references a session, independent of room count. Soft invalidation follows the existing session schema and audit contract.

## 8. Steelman

### Blast radius if unfixed

Any audited viewer-link session can fail to log out. The UI reports failure, the cookie remains, and the active server-side session continues to authorize subsequent requests until another revocation or expiry condition applies.

### Defense-in-depth failure

The application currently asks a strong immutable-audit control to permit an FK side-effect it is designed to reject. Keeping both controls correct requires changing session lifecycle behavior, not weakening the audit trigger.

### Contract alignment

The fix preserves session revocation, link serve default deny, immutable events, and audit attribution. It uses the existing `isActive` field for its intended lifecycle purpose.

### Cost of delay versus careful fix

The correction is one scoped mutation plus unit and integration tests. Delaying leaves a reproduced logout failure in the W1-1 candidate and prevents close-out.

## 9. Pre-Mortem

Assume the fix caused an incident.

### Failure: logout returns 200 but the old token still serves

Likely cause: the update predicate did not match, or a serve path bypasses the active-session lookup.

Detection:

- unit assertion on exact update predicate;
- integration active-token lookup after invalidation;
- CloudVault serve request using the copied pre-logout cookie.

Rollback:

- restore the prior revision;
- do not treat cookie clearing alone as a fix.

### Failure: immutable events are changed or lost

Likely cause: a hard delete remains or a cleanup step nulls `events.sessionId`.

Detection:

- PostgreSQL test asserts the same event and session id remain;
- existing immutability trigger tests stay green;
- code review rejects trigger or FK changes.

Rollback:

- restore the prior revision and preserve all event rows.

### Failure: concurrent logout returns 500

Likely cause: `update()` expects a row that another request already invalidated.

Detection:

- use idempotent `updateMany()` with `isActive=true`;
- unit test a zero-row update result and require cookie clearing plus success.

Rollback:

- restore the prior revision and correct idempotency without reintroducing deletion.

### Failure: session analytics treats inactive rows as active

Likely cause: an analytics query omits the `isActive` state when it intends to report current sessions.

Detection:

- focused search for viewer-session consumers;
- existing analytics tests;
- review that historical analytics may intentionally include inactive sessions.

Rollback:

- correct the consumer query under a separate bounded fix if needed; do not delete audit-linked sessions.

### False confidence from green tests

A mocked Prisma delete or update cannot reproduce FK-trigger behavior. The rollback-only PostgreSQL integration test is mandatory in addition to route unit tests.

## 10. Go or no-go

**GO for implementation after this analysis record is committed.**

Steelman justifies the bounded soft-invalidation change. The pre-mortem protects server-side revocation and immutable evidence, and rollback is code-only. No production deployment is authorized. The security freeze remains active and P0-4 remains accepted and unchanged.
