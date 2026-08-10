# W1-1 Authorization Semantics Design

- **Status:** DESIGN ONLY, awaiting Stakeholder Advisor GO
- **Freeze scope:** P0-1 authorization correctness
- **Default decision:** Option A, room-scoped VIEW
- **Implementation authorization:** Not granted by this document

## Decision summary

Organization membership will remain an identity and administration boundary, but a `VIEWER` organization membership will no longer grant VIEW across every room. A non-admin user must have an active room or resource grant, an active room role, an active group-derived grant, or a valid link scoped to the requested resource.

The current Layer 15 organization VIEWER fallback in `PermissionEngine` will be removed. `RoomService.list()` will return only rooms the actor may view. Revoking the final applicable grant or removing the actor from the granting group will therefore deny access instead of falling through to organization-wide VIEW.

Organization administrators and internal system actors retain their existing full-access semantics. No new customer-visible role or UI label is proposed during silent hardening.

## Current-state observations

1. `PermissionEngine.evaluate()` and `explainPermission()` both implement a Layer 15 fallback that grants VIEW to any active organization `VIEWER` after explicit, group, link, and inherited checks return no grant.
2. The existing revocation and group-removal security tests expect denial, but their mocked organization membership objects omit `isActive`. That makes the tests pass while the production fallback remains reachable for a real active membership.
3. `RoomService.list()` filters by `organizationId` only. It does not invoke `PermissionEngine` or apply a room-access predicate.
4. The public `/api/rooms` route independently lists organization rooms and likewise does not apply resource authorization beyond organization and room status.
5. Production service calls commonly construct actors with `userId` and organization role only. `PermissionEngine` group evaluation depends on caller-supplied `actor.groupIds`, and no production caller was found populating those IDs.
6. `Permission.permissionLevel` already includes `NONE`, but the schema does not enforce one active logical record per grantee and resource. Deny precedence therefore must be deterministic even when historical duplicate rows exist.
7. Link rules are distributed across `PermissionEngine`, `/api/links/[slug]`, `/api/view/[shareToken]/info`, `/api/view/[shareToken]/access`, and `viewerSession`. Expiry, maximum views, room status, identity, scope, and maximum session duration are not evaluated by one shared contract.
8. The schema has no link start or schedule field. Schedule-based eligibility is therefore unsupported today and must be stated as unsupported rather than implied to be enforced.

## Authorization contract

### Organization roles

| Actor                                       | Default room access                                       |
| ------------------------------------------- | --------------------------------------------------------- |
| Internal system actor                       | Full access, only from allowlisted server-side call sites |
| Active organization ADMIN                   | Full organization access                                  |
| Active organization VIEWER                  | No room access by membership alone                        |
| Inactive or missing organization membership | Denied                                                    |

`actor.role` remains advisory context only. The engine must continue to resolve the membership in the resource organization and must not trust a claimed role.

### Resource evaluation order

For non-admin users, evaluate access in the following order inside one organization-scoped transaction:

1. Prove active membership in the resource organization.
2. Resolve the active room role for the requested room.
3. Resolve active direct user permissions at the exact resource.
4. If any exact-resource direct user permission is `NONE`, deny. This deny beats group grants and inherited grants at the same or broader scope.
5. Otherwise choose the strongest active exact-resource direct user permission.
6. Resolve current group membership from the database, not from caller-supplied group IDs.
7. If any exact-resource group permission is `NONE`, deny unless a stronger direct user override at that same exact resource was already selected. The direct-user record is the administrator's specific exception to a group rule.
8. Otherwise choose the strongest active exact-resource group permission.
9. Apply inheritance one parent at a time, document to folder to room. At each parent, evaluate deny before allow.
10. If no applicable grant exists, deny.

Organization ADMIN and system access remain above resource denies. A room ADMIN role remains an explicit administrative grant and is not treated as an inherited viewer baseline.

### Document override rule

A direct document permission is more specific than folder or room permissions:

- Direct document `NONE` denies the document even when the room or a group grants VIEW.
- Direct document VIEW or DOWNLOAD may allow that document even when no broader room content grant exists.
- A document-only grant does not imply that the actor may enumerate all room contents.

The room navigation shell for a document-only grant is an implementation detail. The safe default for this silent change is to expose only the granted document and the minimum parent labels needed to navigate to it. It must not widen the room document query.

### Room list semantics

`RoomService.list()` and `/api/rooms` must share one access-scope builder. Post-filtering an already paginated result is not acceptable because it produces incorrect totals and can skip accessible rooms.

For an organization ADMIN, the existing organization-scoped query remains valid.

For a VIEWER, the queryable room set is the union of rooms where the actor has at least one of:

- an active room role assignment;
- an active, non-expired direct user permission on the room;
- an active, non-expired group permission on the room through a current group membership; or
- an active, non-expired direct user or group permission on a child folder or document, solely to expose the restricted room shell needed for that resource.

An applicable `NONE` record removes the denied resource from the effective result. A child-only grant must not expose sibling folders or documents.

The same effective room predicate must drive `count` and `findMany`, with stable ordering and pagination.

### Group membership

The permission engine will derive group membership in the same transaction used for authorization. The lookup must join `group_memberships` to active groups in the resource organization and the current user.

Caller-supplied `groupIds` will be removed from the trusted authorization input or treated only as an optimization that is intersected with the authoritative database result. The preferred design is to remove it from the public `Actor` contract.

### Link evaluation

Introduce one server-side link eligibility module used by all link bootstrap and viewer-session endpoints. It returns a typed allow or deny result with an internal reason code.

The common evaluation must cover:

- link exists and is active;
- link organization and room identity match the requested resource;
- room is active;
- expiry;
- maximum views, with the admission increment performed atomically;
- asserted email requirement and allowlist;
- password requirement, while password comparison remains at the boundary that owns the submitted secret;
- NDA and IP restrictions where the endpoint owns those inputs;
- link scope: entire room, folder subtree, or exact document;
- maximum session duration for established viewer sessions; and
- link revocation after a viewer session has been created.

The schema has no start or schedule field. The module will report schedule enforcement as not applicable until a separately approved schema change introduces it.

Admission must avoid a maximum-view race. The view-count increment should be a conditional update in the organization transaction whose predicate still requires `viewCount < maxViews` when a limit exists.

## Proposed implementation slices after GO

1. Permission precedence and authoritative group resolution.
2. Filtered room-list access scope shared by service and route.
3. Central link eligibility module and endpoint adoption.
4. Synthetic two-organization integration suite.
5. CloudSpace behavior smoke, then minimal Brightside smoke only through the approved path.

Each slice should be a small, reversible PR where practical. No UI redesign is included.

## Test plan

### Unit and contract tests

- Active organization VIEWER with no grants is denied.
- Organization ADMIN is allowed.
- Claimed ADMIN without membership is denied.
- Active room grant allows only that room.
- Revoking the final room grant denies immediately.
- Removing a user from the granting group denies immediately.
- Revoking a group permission denies immediately.
- Exact document `NONE` beats inherited room VIEW.
- Exact document VIEW overrides the absence of a broader room-content grant without exposing siblings.
- Expired direct permissions are ignored.
- Permission explanation and boolean evaluation return the same result.
- Duplicate historical permission rows resolve deterministically with deny precedence.

### Synthetic integration tests

Create two organizations with two rooms each and at least three users:

- org admin;
- viewer with a room grant; and
- viewer with a group grant.

Prove:

- cross-organization access is denied;
- room lists contain only the effective room set;
- pagination totals match the filtered set;
- revoke and group removal remove the room from the list and deny direct access;
- document override reveals only the intended document;
- expired link, inactive link, exhausted max views, wrong organization, wrong room, and wrong document scope are denied;
- viewer-session access is denied after link revocation; and
- maximum-view admission cannot exceed its limit under concurrent attempts.

All destructive fixtures run only in disposable CI PostgreSQL or an approved synthetic CloudSpace fixture. No Brightside isolation or exploit tests are permitted.

## Rollout and rollback

1. Record the current release, web revision, worker revision, and image digests.
2. Deploy through the existing pipeline with the previous revision retained.
3. Smoke the approved CloudSpace organization first using two rooms and a restricted viewer.
4. Verify login, room list, allowed room, denied room, grant revocation, group removal, document override, and logout.
5. Perform only the approved minimal Brightside smoke. Do not enumerate rooms or documents beyond the known path.
6. Detect failure within five minutes through quick health, authentication smoke, authorization test results, and application error rate.
7. Roll back traffic to the previous web revision if behavior is incorrect. This change is application-only unless a later slice adds a permission uniqueness migration. Any migration requires a separate rollback procedure.

## Strawman

- Brightside is single-room today. Removing the VIEWER baseline may solve a future multi-room contract problem before it is customer-visible.
- The simplest control is to filter room lists but retain direct-access behavior. That achieves part of the risk reduction with less behavior change.
- Existing invitations may rely on organization VIEWER automatically seeing the room, because the current tests explicitly describe that behavior.
- A child-resource grant that changes room navigation could appear broken even when the authorization result is safer.
- Centralizing every link rule at once can make a focused authorization fix larger than necessary.

## Steelman

- Organization membership is not a VDR room grant. Retaining the baseline makes revocation and group removal ineffective for VIEW.
- A future second Brightside room or another tenant immediately expands the blast radius without another code change.
- Application authorization, RLS, and database privilege are independent defenses. The current organization-wide fallback weakens the application layer while RLS is also incomplete and the web process still holds an admin database URL.
- `RoomService.list()` currently violates the stated permission contract directly.
- Group permissions cannot be trusted if production callers do not supply group IDs.
- Central link eligibility prevents endpoint drift from turning an expired or scoped link into a valid session through a less complete route.

## Pre-Mortem

Assume this change caused an incident:

- Brightside login succeeds but the room list is empty because its viewer workflow depended on the baseline.
- An invitation creates organization membership but no explicit room grant, so the invitee sees a broken product.
- The filtered count and item query use different predicates, causing missing or duplicated rooms across pages.
- A direct document grant exposes the room shell and accidentally lists sibling documents.
- Group membership is cached or caller-supplied, so removal does not revoke access promptly.
- Link admission checks `maxViews` before incrementing and concurrent requests exceed the cap.
- Green unit tests mask a real fixture whose membership has `isActive: true`, repeating the current mock weakness.

Detection within five minutes:

- CloudSpace login and restricted room-list smoke;
- a synthetic revoke and group-removal check;
- quick health only;
- authorization-denied and route-error telemetry; and
- comparison of expected and returned room counts in the synthetic fixture.

Rollback:

- route traffic to the retained previous web revision;
- do not change database grants or RLS in the same PR;
- if a permission uniqueness migration is later proposed, prepare and test a forward repair rather than relying only on application rollback.

False confidence controls:

- Unit mocks must include realistic `isActive` values.
- Integration tests must use the runtime database role and real relations.
- A passing room-list test is not proof that document, download, link, or viewer-session endpoints share the same semantics.

Silent-hardening risk:

- A Brightside user may interpret a missing room as data loss. The pre-deploy inventory must prove the known Brightside path has an explicit grant or administrator semantics before rollout.

## Go or no-go recommendation

**Recommendation:** GO for implementation after Advisor approval of Option A and the document-only room-shell behavior.

Required before coding:

1. Confirm the approved CloudSpace organization and two-room test identities.
2. Inventory how current Brightside users receive room access without reading customer document content.
3. Confirm invitation creation also creates the required room grant, or include that correction in the same authorization control family.
4. Approve the link-centralization boundary or explicitly defer specified endpoint layers with tests.

## References

- `src/lib/permissions/PermissionEngine.ts`
- `src/lib/permissions/PermissionEngine.security.test.ts`
- `src/lib/permissions/PermissionEngine.test.ts`
- `src/services/RoomService.ts`
- `src/services/RoomService.test.ts`
- `src/app/api/rooms/route.ts`
- `src/app/api/links/[slug]/route.ts`
- `src/app/api/view/[shareToken]/access/route.ts`
- `src/app/api/view/[shareToken]/info/route.ts`
- `src/lib/viewerSession.ts`
- `prisma/schema.prisma`
