# W1-1 Room-Scoped Authorization Design

- **Date:** 2026-08-10
- **Status:** Design only, Advisor review required
- **Decision owner:** Stakeholder Advisor
- **Implementation status:** Blocked pending explicit W1-1 GO
- **Default selected:** Option A, room-scoped VIEW

## 1. Decision summary

Adopt Option A. Active organization membership establishes tenant affiliation but does not grant VIEW on every room. A non-admin user must have an active, unexpired grant on the requested room or resource, receive such a grant through an active group, or use a valid scoped link. Organization administrators retain organization-wide administrative access. Room administrators retain administrative access only in their assigned rooms.

The implementation will remove the final organization VIEWER baseline from `PermissionEngine`, make room listing use the same authorization semantics as direct room access, make revocation and group removal return to default deny, and centralize the link constraints that are represented by the current schema. No new role, UI, feature, schema field, customer communication, or malware-scanning behavior is part of W1-1.

## 2. Why Option A is the selected design

The canonical permission contract says:

- no grant means no access;
- organization VIEWER is a non-admin baseline, with access supplied by explicit permissions, groups, links, or room-scoped elevation;
- non-admin users are limited to explicitly assigned rooms;
- explicit deny wins;
- the permission engine is the source of truth.

The current implementation conflicts with that contract in two material places:

1. `PermissionEngine.evaluate()` ends with a Layer 15 rule that grants VIEW on organization resources to every active organization VIEWER.
2. Both `RoomService.list()` and `GET /api/rooms` query all matching rooms in the organization without applying resource authorization.

Brightside is currently single-room, so this is not treated as evidence of an active multi-room disclosure. It is still a correctness defect and a future multi-room safety defect. Option A fixes the contract directly without adding a second internal role whose behavior would be difficult to explain or maintain.

## 3. Observed implementation gaps

This section records repository evidence only. It does not claim that any Brightside customer row was queried or exposed.

### 3.1 Organization VIEWER fall-through

`PermissionEngine.evaluate()` and `explainPermission()` both apply an organization VIEWER baseline after all explicit, group, link, and inherited checks. A revoked room permission therefore falls through to an organization-wide VIEW allow when the membership is active.

Some current unit tests intentionally expect this baseline. Other security tests expect revocation and group removal to deny, but their membership fixtures omit `isActive`, which prevents the baseline from running. Those green tests do not prove the production invariant.

### 3.2 Room list bypass

`RoomService.list()` filters by `organizationId`, status, and search only. `GET /api/rooms` implements a second direct Prisma list and count rather than calling the service. Both paths can return rooms that `RoomService.getById()` would need the permission engine to authorize.

Filtering after pagination is not acceptable because it creates incorrect totals, sparse pages, and possible room-count disclosure. Authorization must constrain the database query before count, offset, and limit are applied.

### 3.3 Group membership is caller-dependent

The permission engine checks group grants only when callers populate `Actor.groupIds`. Room service calls currently provide `userId` and the session role but do not provide group IDs. Group access must be resolved by the engine inside the organization-scoped transaction, not trusted as caller-supplied authorization state.

### 3.4 Deny precedence is incomplete

`PermissionLevel.NONE` can express a deny, but current resolution has gaps:

- direct user permission uses `findFirst()` without a deterministic order if duplicate active records exist;
- group permissions sort for the highest level, so an allow can beat a group deny;
- a denied folder evaluation returns no inherited result, after which document evaluation can continue to the room and inherit an allow;
- direct user decisions return before group decisions, so a deny in one source is not compared with an allow in another source;
- inactive or deleted grants correctly disappear, but the organization baseline can restore VIEW.

The implementation must evaluate all applicable non-admin decisions before selecting the result.

### 3.5 Link constraints are split across endpoints

`PermissionEngine.getLinkPermission()` currently checks only `isActive`, scope, and link permission. Public link and viewer-session routes separately check some combination of expiry, room status, maximum views, email, password, NDA, IP restrictions, session activity, and session duration.

This produces different answers depending on the entry point. The present `Link` schema has expiry, maximum views, maximum session minutes, email restrictions, password requirements, permission, scope, and active status. It has no stored access-window schedule. The permission specification describes scheduled access, but W1-1 will not add that feature or a new schema field.

## 4. Authorization contract

### 4.1 Tenant and identity gates

All checks run inside `withOrgContext(resource.organizationId, ...)` using the constrained runtime database role.

For an authenticated user:

1. The resource organization must equal the organization bound to the authenticated session.
2. The user must have an active membership in that organization.
3. An organization ADMIN is allowed within that organization.
4. A room ADMIN assignment is allowed within that room and its descendants.
5. A non-admin must have an applicable allow after deny resolution.

For a link visitor:

1. The viewer session, link, room, and requested resource must have the same organization and room identity.
2. A link does not bypass tenant scoping.
3. A link decision is independent of organization membership.

The `Actor.role` field is not an authorization input. Persisted membership and role assignment rows are authoritative. It may remain temporarily for compatibility but must not grant access.

### 4.2 Non-admin grant resolution

For the requested resource, load all active, unexpired user and active-group permission records that apply directly or through permitted inheritance. Resolve them as follows:

1. Any applicable `NONE` decision denies the requested action.
2. A deny on a parent applies to descendants when the record is inheritable.
3. A direct resource deny applies regardless of an inherited allow.
4. If no deny applies, use the highest applicable allow level.
5. If no applicable allow exists, deny.

This deny precedence applies to non-admin permissions. It does not remove the documented organization ADMIN or room ADMIN authority.

The implementation must enforce a database uniqueness rule or an application invariant that prevents multiple live decisions for the same grantee and resource tuple. Until that invariant is enforced, the engine must load and resolve every matching row deterministically rather than using an unordered `findFirst()`.

### 4.3 Inheritance

Inheritance flows only from room to folder to document. Child grants do not create a room-wide grant. A document-only grant can authorize the document, but it does not authorize unrelated room contents.

`inheritFromParent=false` is authoritative. The implementation must not recursively call `evaluate()` in a way that discards an explicit parent deny and then proceeds to a more distant allow.

### 4.4 Revocation

Revoking or deactivating a user permission, deleting an active group membership, revoking the group permission, deactivating organization membership, revoking a room-admin assignment, or deactivating a link removes that grant immediately for the next request. The result is default deny unless another independent active grant remains.

No organization VIEWER fallback exists after this change.

If permission caching is introduced later, mutation paths must synchronously invalidate all affected actor, group, room, folder, and document keys. W1-1 does not introduce a permission cache.

### 4.5 Room listing

Add a batch authorization method owned by the permission module, conceptually:

```typescript
getViewableRoomIds(actor, organizationId, client): Promise<Set<string>>
```

For organization ADMIN, the room query remains organization-scoped without an ID restriction. For non-admin users, the method derives the authorized room set from:

- active room ADMIN assignments;
- active, unexpired direct user room VIEW or higher grants;
- active, unexpired room VIEW or higher grants belonging to active groups in which the user is currently a member;
- deny precedence over those candidate grants.

The engine loads group membership itself. It does not accept `groupIds` from the request as proof.

`RoomService.list()` applies the resulting room IDs in the Prisma `where` clause before both count and page selection. `GET /api/rooms` becomes a thin adapter over `RoomService.list()` so there is one list contract. Non-admin active-room filtering remains a product rule after authorization, not a substitute for authorization.

Document-only and folder-only grants do not add the parent room to the general room list. Those grants remain usable only through an already authorized navigation or a direct scoped route. If product review later requires container discovery for document-only grants, that is a separate, explicit behavior decision and is not inferred during this hardening change.

### 4.6 Link policy

Introduce one typed link policy module used by public link admission, viewer-session validation, document listing, preview, download, page-view, and PermissionEngine link evaluation.

The module has two phases so maximum-view semantics remain coherent:

#### Admission phase

Before a viewer session is created, require:

- active link;
- active room;
- unexpired link;
- view count below `maxViews`, when configured;
- matching link, room, and organization identities;
- valid password when required;
- asserted and allowed email when required;
- accepted NDA when required;
- allowed source IP when the room allowlist is configured;
- valid link scope and permission.

The maximum-view check and increment must occur atomically in the same organization-scoped transaction. Concurrent requests must not exceed the configured maximum.

#### Serve phase

For every subsequent resource request, require:

- active viewer session;
- viewer cookie token bound to the requested share token;
- active and unexpired link;
- session age within `maxSessionMinutes`, when configured;
- matching session, link, room, resource, and organization identities;
- requested resource within the link scope;
- link permission sufficient for VIEW or DOWNLOAD.

Reaching `maxViews` after a session was successfully admitted does not invalidate that newly admitted session. It prevents additional admissions. Revocation, expiry, session revocation, and scope mismatch deny existing sessions immediately.

The current schema has no scheduled access-window field. W1-1 records schedule evaluation as not applicable to persisted behavior. No endpoint may implement a private schedule rule outside the central module. A future schedule field requires a separately approved feature change and central policy tests.

## 5. Proposed implementation boundaries

Use small, reversible PRs after Advisor GO:

1. Permission resolution and regression tests.
2. Room-list batching and route consolidation.
3. Link-policy centralization and link regression tests.

One PR is acceptable if splitting would temporarily expose inconsistent authorization behavior. The implementing PR must include the approved design record before code changes.

Expected code areas include:

- `src/lib/permissions/PermissionEngine.ts`
- a new typed link-policy module under `src/lib/permissions/` or `src/lib/`
- `src/services/RoomService.ts`
- `src/app/api/rooms/route.ts`
- public link and viewer-session routes that currently repeat constraint checks
- permission and room-list tests

No Prisma migration is expected for the baseline correction. A uniqueness constraint for permission tuples must be proposed separately in the implementation PR if repository data analysis shows it can be added safely. No production data query is authorized by this design.

## 6. Verification plan

### 6.1 Unit and service tests

Add deterministic tests for:

- active organization VIEWER with no grant is denied;
- organization ADMIN can view both rooms in the same organization;
- room ADMIN can view the assigned room and not the second room;
- direct room VIEW grants only that room;
- revoked or inactive room permission denies and does not fall through;
- expired permission denies and does not fall through;
- group room VIEW grants access;
- group removal immediately denies;
- group permission revocation immediately denies;
- explicit `NONE` beats user, group, room, and inherited allows for a non-admin;
- folder deny prevents a document from inheriting a room allow;
- document deny prevents an inherited folder or room allow;
- document allow does not expose a second document or second room;
- cross-organization actor and resource identifiers deny;
- `explainPermission()` reports the same decision and reason code as `evaluate()`;
- room list count, pagination, search, and status are computed after authorization;
- the API route and service return the same authorized list.

### 6.2 Link tests

Add tests for:

- inactive link;
- expired link;
- active link with future expiry;
- maximum-view boundary and two concurrent final admissions;
- room not active;
- organization mismatch;
- room mismatch;
- folder and document scope mismatch;
- allowed and disallowed asserted email;
- password required and invalid password;
- NDA and IP gates at admission;
- session revocation;
- maximum session duration;
- VIEW link denied for DOWNLOAD;
- document-scoped link denied for a second document;
- link revocation invalidates an existing viewer session;
- maximum views blocks new admission without invalidating the admitted session.

### 6.3 Synthetic integration fixture

Use a disposable PostgreSQL database and a synthetic two-organization fixture:

- Organization A has rooms A1 and A2.
- Organization B has room B1.
- Organization A has an admin, Viewer One, Viewer Two, and two groups.
- Viewer One receives direct access to A1 only.
- Viewer Two receives group access to A2 only.
- Add document and folder overrides, expiring grants, and scoped links.

Exercise list, direct room, folder, document, preview, and download paths. Prove that revocation and group removal deny on the next request and that no route reveals B1 from Organization A.

### 6.4 CloudVault verification

CloudVault is the authorized development organization for full CRUD testing. Create synthetic rooms and viewers there only after implementation GO. Test the full two-room matrix, revocation, group removal, expired link, and document override. Record only synthetic identifiers or categorical results in evidence. Do not record credentials, customer document names, document contents, or secret values.

### 6.5 Brightside boundary

Do not use Brightside for authorization discovery, exploit testing, room-list scraping, metadata listing, or content access. After an approved deployment, the production check is limited to quick health and the separately authorized minimal login, known single-room path, and logout smoke. If the change causes a known Brightside workflow to lose expected access, stop, restore the prior revision, and escalate to the Advisor.

## 7. Deployment and rollback

### 7.1 Deployment

1. Run clean install, type-check, lint, unit tests, synthetic authorization integration tests, and safe RLS tests.
2. Record current web and worker revisions, image digests, release SHA, and traffic before mutation.
3. Deploy through the existing pipeline only.
4. Keep the previous web revision and image available.
5. Verify Azure readiness and quick uncached identity health only. Do not use deep health.
6. Run CloudVault smoke before the minimal Brightside smoke.
7. Confirm room list and direct room access agree for every synthetic viewer.

The change has no database migration and should fit the unannounced five-minute impact budget.

### 7.2 Rollback

Restore traffic to the prior web revision and its pinned image. No data rollback is required. Confirm quick health, CloudVault login, and the prior authorization behavior. Record that the security defect has been reintroduced and keep the freeze active while the implementation is corrected.

Rollback must be started immediately if login fails, the app shell is blank, CloudVault authorized users cannot open their assigned room, a denied synthetic viewer can list or open an unassigned room, or the change cannot be verified within five minutes.

## 8. Strawman

### What if the finding is product intent rather than a bug?

The Layer 15 comments and tests show that an organization-wide viewer baseline was intentionally added. Brightside is single-room, so that behavior can appear equivalent to room-scoped access today. However, it conflicts with the canonical permission contract and the stakeholder's explicit product direction. Keeping it would require Option B, a clearly named internal role and honest UI. No such role exists, and adding one would expand scope.

### What simpler control achieves most of the risk reduction?

Filtering only `GET /api/rooms` would reduce room-name disclosure but leave direct room, folder, and document checks vulnerable to the same fallback. Removing only Layer 15 would fix direct decisions but leave unfiltered listing and divergent link rules. The smallest coherent control is to remove the baseline, reuse the same decision contract for list and direct access, and centralize existing link constraints.

### What workflows might break?

- a Brightside or CloudVault organization VIEWER who has no room permission because the baseline previously supplied access;
- invite flows that create organization membership but fail to create a room grant or link;
- group access where callers relied on passing group IDs inconsistently;
- document-only permissions if the UI assumes they also make the room discoverable;
- existing viewer sessions if central link expiry or revocation checks are stricter than an endpoint's current checks.

The synthetic matrix and CloudVault CRUD verification must expose these dependencies before production traffic moves.

### Are we optimizing for an ideal multi-tenant VDR while Beta is single-room?

Yes, in part. The immediate Brightside exposure is limited by its single-room posture. The control is still justified because it aligns existing code with an existing contract and prevents a predictable defect when a second room is added. It does not introduce a new UI, role taxonomy, or feature.

## 9. Steelman

### Blast radius if unfixed

Any active organization VIEWER can receive VIEW on every current and future room in that organization after explicit grants are exhausted. A permission revocation or group removal can appear successful in the database and UI while access remains through the baseline. An unfiltered room list advertises resources before a direct check occurs.

### Defense-in-depth failure

This defect combines dangerously with the open privilege and RLS findings. An application authorization mistake, incomplete RLS coverage, and an admin-capable web credential remove independent barriers. Correct room authorization reduces the blast radius even before W1-2 and W1-3 close.

### Contract alignment

Option A directly implements default deny, explicitly assigned room access, deny precedence, scoped link access, and a single authorization source. It also makes revocation behavior testable instead of depending on missing fixture fields.

### Cost of delay versus careful change

The implementation is mostly application logic and tests, with no required data migration. The main cost is identifying workflows that relied on the baseline. CloudVault and synthetic fixtures provide a safe way to prove those workflows before a short, reversible deployment.

## 10. Pre-Mortem

Assume W1-1 caused an incident.

### Failure: Brightside viewer cannot open its room

Likely cause: the invite path created only organization membership and relied on Layer 15.

Detection within five minutes:

- CloudVault invite and assigned-room smoke fails first; or
- the minimal Brightside known-path smoke returns 403, 404, login redirect, or a blank shell.

Rollback:

- route traffic to the prior web revision;
- verify quick health and the known path;
- do not add a broad emergency grant or restore Layer 15 in an ad hoc production edit;
- escalate the workflow dependency to the Advisor.

### Failure: room list looks correct but direct document access leaks

Likely cause: the list received a new filter while a direct route still uses the old permission path or bypasses the engine.

Detection:

- synthetic direct URL tests for A2 and B1;
- route inventory test that requires protected resource endpoints to call the central decision path;
- comparison of list and direct decisions for the same actor and room.

Rollback:

- restore the prior revision and keep the freeze active;
- correct the route inventory before another deploy.

### Failure: explicit deny blocks administrators

Likely cause: deny aggregation was applied before documented organization or room admin authority.

Detection:

- unit matrix for organization ADMIN and room ADMIN with conflicting non-admin ACL rows;
- CloudVault admin open-room smoke.

Rollback:

- restore the prior revision;
- correct decision ordering without changing persisted permissions.

### Failure: pagination omits or repeats rooms

Likely cause: authorization was applied after offset and limit or authorized IDs were derived with duplicate joins.

Detection:

- synthetic pagination tests across more than one page;
- compare total to unique authorized room IDs;
- assert stable ordering with an ID tie-breaker.

Rollback:

- restore the prior revision because incorrect listing is a user-visible authorization defect.

### Failure: link sessions are denied immediately at the maximum-view boundary

Likely cause: the serve phase interprets `viewCount >= maxViews` as revoking the session that consumed the final allowed admission.

Detection:

- exact-boundary and concurrent-admission tests;
- CloudVault synthetic final-view smoke.

Rollback:

- restore the prior revision;
- preserve the admission versus serve distinction.

### False confidence from green tests

Mocked membership records can omit `isActive`, group IDs can be injected by tests but omitted by real callers, and route tests can mock the permission engine entirely. Required acceptance includes a real PostgreSQL synthetic fixture, real route calls, and list/direct negative cases.

### Silent-hardening behavior change

The intended behavior change is that unassigned organization VIEWER accounts no longer see rooms. A Brightside user who relied on that behavior may interpret the result as a broken product. The Advisor must explicitly accept this Option A behavior before implementation, and rollback must remain available during production smoke.

## 11. Go or no-go

**GO for Advisor review of this design.**

**NO-GO for implementation.** Implementation requires a written W1-1 Advisor GO that accepts Option A, the document-only and folder-only room-discovery rule, the admission versus serve interpretation of `maxViews`, the CloudVault test plan, and the production rollback procedure.

The security freeze remains active. P0-4 remains accepted and unchanged.

## References

- `PERMISSION_MODEL.md`
- `CANONICAL_CONTRACTS.md`
- `prisma/schema.prisma`
- `src/lib/permissions/PermissionEngine.ts`
- `src/lib/permissions/PermissionEngine.test.ts`
- `src/lib/permissions/PermissionEngine.security.test.ts`
- `src/services/RoomService.ts`
- `src/app/api/rooms/route.ts`
- `src/app/api/links/[slug]/route.ts`
- `src/app/api/view/[shareToken]/access/route.ts`
- `src/lib/viewerSession.ts`
