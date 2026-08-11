# W1-1 Document List Set-Based Authorization Review Correction

- **Date:** 2026-08-11
- **Status:** Analysis complete, implementation authorized under the existing W1-1 defect-fix GO
- **Decision owner:** Stakeholder Advisor
- **Review source:** PR #125, unresolved document-list scalability thread
- **Control family:** W1-1 authorization and operational safety
- **Production baseline during implementation:** W0
- **Deployment status:** Not authorized

## 1. Decision summary

Replace the per-document `PermissionEngine.can()` loop in `DocumentService.list()` with a prepared, set-based document-view authorizer owned by `PermissionEngine`.

The authorizer will load persisted authority, active groups, target-room folder ancestry, and applicable active permissions once. It will apply the existing permission precedence to bounded candidate pages in memory. `DocumentService.list()` will scan document identity candidates with a bounded keyset query, compute the exact authorized total, then fetch only the requested authorized page.

Organization and room administrators remain unrestricted and use direct database count and pagination. No authorization decision will use caller-supplied roles or group IDs.

## 2. Review finding and root cause

The first correction is authorization-correct, but its database work is not bounded. It loads every candidate document and invokes `PermissionEngine.can()` for each candidate inside one interactive transaction. The constant named `AUTHORIZATION_BATCH_SIZE` limits concurrent promises only. It does not limit the total membership, role, group, folder-lineage, or permission queries.

For a large room, the total query count grows with the number of documents and folder depth. Prisma interactive transactions default to a short timeout. A correct authorization control that causes large-room list requests to time out would violate the operational mandate and could turn the security fix into a production outage.

## 3. Implementation boundary

Expected files are limited to:

- `src/lib/permissions/PermissionEngine.ts`
- focused PermissionEngine unit tests
- `src/services/DocumentService.ts`
- `src/services/DocumentService.test.ts`
- `tests/integration/authorization-room-scope.test.ts` only if additional runtime-role evidence is needed
- `tests/integration/event-immutability.test.ts` and `src/lib/viewerSession.ts` for the separate production-helper coverage requested in the same review
- this analysis record

No migration, RLS policy, role grant, link policy, malware behavior, pipeline logic, Azure resource, Key Vault value, networking, customer data, Brightside access, Medau work, or deployment is included.

## 4. Set-based authorization design

### 4.1 Prepared authority

Add a `PermissionEngine` method that prepares document-view authorization for one actor, organization, and room inside the caller's database context.

The method will:

1. Deny actors with link identity, missing user identity, or inactive organization membership.
2. Return unrestricted authority for system actors, persisted organization administrators, and persisted room administrators.
3. Load active database group memberships once for a non-admin user.
4. Load target-room folder IDs and parent IDs once.
5. Load the actor's and active groups' non-expired, active permissions once.
6. Keep only permissions applicable to the target room, its folders, or candidate document IDs during in-memory evaluation.

The permission query remains organization-scoped. Filtering direct document permissions by candidate ID in memory preserves existing behavior even for a legacy permission row whose optional `roomId` is null.

### 4.2 Identical precedence

For each document candidate:

1. Persisted organization or room administrator authority wins before non-admin ACL denies.
2. Direct document permissions apply to that document.
3. Folder permissions apply only when `inheritFromParent=true` and the folder is the candidate's direct folder or an ancestor in the target room.
4. Room permissions apply only when `inheritFromParent=true` for document access.
5. Any applicable `NONE` denies the non-admin actor.
6. Otherwise the strongest applicable level is compared with `VIEW`.
7. No applicable permission means default deny.

This matches the existing single-resource `PermissionEngine.evaluate()` contract.

### 4.3 Bounded candidate reads

`DocumentService.list()` will read candidate `id`, `folderId`, and ordering fields in fixed-size keyset pages using `take`, the existing deterministic `createdAt DESC, id ASC` order, and an ID cursor.

The service must scan all candidate identities for a non-admin actor because the API returns an exact authorized total and supports arbitrary offset pagination. Each candidate query is bounded, and permission-related database round trips do not grow per document.

The service will preserve authorized candidate order, calculate the exact authorized total, slice the requested page, fetch only those full document rows, and restore candidate order after the `IN` query.

### 4.4 Unrestricted path

For system, organization-admin, or room-admin authority, use direct `document.count()` plus database `skip` and `take`. This preserves efficient pagination for the common administrative path and avoids an unnecessary candidate scan.

## 5. Verification plan

### PermissionEngine unit tests

- More than eight candidates are evaluated without calling the single-resource `can()` path.
- Membership, room role, group membership, folder map, and permission queries execute once per prepared authorizer.
- Direct document `NONE` excludes only the denied document.
- Inheritable ancestor folder `NONE` excludes nested documents.
- Allowed siblings remain visible.
- Organization and room administrators remain unrestricted despite non-admin ACL denies.
- Inactive membership and missing identity return no viewable IDs.

### DocumentService unit tests

- Candidate reads use a fixed `take` and keyset cursor when more than one batch is required.
- More than eight candidates are handled by the prepared set-based authorizer.
- Authorization occurs before total, offset, and limit.
- Denied documents do not appear in items or total.
- Full document rows are fetched only for the authorized requested page and restored to candidate order.
- Unrestricted authority uses direct count and pagination.

### PostgreSQL integration

Retain the existing runtime-role test proving room VIEW plus direct document `NONE` excludes that document from list items and total, direct access is denied, siblings remain visible, and inheritable ancestor `NONE` excludes nested documents.

### Viewer-session helper follow-up

The same PR review asks for committed coverage of the production `getViewerSessionByToken()` predicate after soft invalidation. Allow the helper to accept an optional trusted Prisma client for transaction-local integration testing while retaining `bootstrapDb` as the production default. The rollback-only test will call the real helper with its transaction client and require no active session result, then require a 401 serve decision and unchanged event evidence.

## 6. Rollback

There is no migration. Restore the prior code or retained W0 web revision if a later deployment changes list results or latency. W1-1 remains open until CloudVault acceptance and Advisor close-out.

## 7. Strawman

### What if the original batch of eight is already sufficient?

It limits concurrent work but still performs permission-related database queries for every document. A room with hundreds of documents can exceed the transaction timeout even when only eight promises run at once.

### What simpler control achieves most of the reduction?

Increasing the transaction timeout would hide the unbounded query plan and extend resource occupancy. Adding `take` without preserving exact totals would change the API contract. A prepared set-based authorizer plus bounded candidate reads removes the main query amplification without changing behavior.

### What workflow might break?

- Legacy permissions with a null `roomId` could be dropped by an overly narrow permission query.
- Folder cycles or cross-room parent references could create incorrect inheritance.
- Keyset pagination could skip or duplicate candidates if ordering is not deterministic.
- In-memory filtering could accidentally let a weaker allow override `NONE`.
- A new batch path could drift from the single-resource engine.

The design loads organization-scoped actor permissions, constrains folder maps to the target room, detects lineage cycles, uses a unique ID cursor with deterministic ordering, and explicitly preserves deny precedence.

### Are we over-optimizing for a future large room?

No. The code review identified a direct interaction with the production transaction timeout. Operational safety is part of the approved freeze, and the correction remains within the same authorization defect.

## 8. Steelman

### Blast radius if unfixed

A document list request can time out as room size grows, creating a user-visible failure and repeated database load. The failure would affect administrators and viewers at a primary room entry point.

### Defense-in-depth failure

Pressure to restore availability after a timeout-prone security fix could lead to bypassing document authorization or reintroducing the original discovery leak. A bounded implementation avoids that operational incentive.

### Contract alignment

The correction keeps authority inside `PermissionEngine`, preserves room-scoped VIEW, explicit-deny precedence, database-derived group identity, authorization before count and pagination, RLS transaction context, and direct-access 404 behavior.

### Cost of delay versus careful fix

The correction is contained to one prepared authorization method, one service query path, and focused tests. Merging the known unbounded implementation would create avoidable operational risk before any production deploy GO.

## 9. Pre-Mortem

Assume the correction caused an incident.

### Failure: a denied document appears in list results

Likely cause: folder lineage or direct document permission indexing differs from the single-resource engine.

Detection:

- direct and ancestor deny unit cases;
- runtime-role PostgreSQL integration;
- CloudVault matrix before Brightside.

Rollback:

- retain W0 live while this PR is reviewed;
- restore the prior revision if a later candidate fails CloudVault.

### Failure: large rooms still time out

Likely cause: candidate reads are not bounded, authority preparation repeats per candidate page, or the actor has an extreme permission inventory.

Detection:

- unit assertions on `take`, cursor progression, and one prepared authorizer;
- review the fixed query count;
- CloudVault synthetic large candidate fixture before deploy.

Rollback:

- restore the prior revision and keep W1-1 open;
- do not increase production timeouts as an unreviewed workaround.

### Failure: list order or pagination changes

Likely cause: candidate and full-row queries use different ordering, or cursor progression is not unique.

Detection:

- deterministic created-time plus ID order;
- unit test spanning more than one candidate batch;
- exact items, total, and `hasMore` assertions.

Rollback:

- restore the prior revision and correct keyset ordering before another deploy GO.

### Failure: administrator access is restricted

Likely cause: non-admin ACL filtering runs before persisted administrator authority.

Detection:

- organization-admin and room-admin unit cases;
- existing W1-1 integration matrix.

Rollback:

- restore the prior revision;
- do not reintroduce an org VIEWER fallback.

### False confidence from green tests

Mocks can prove query shape but not RLS behavior. The existing runtime-role PostgreSQL test remains mandatory, and CloudVault remains the acceptance environment after a separate deploy GO.

## 10. Go or no-go

**GO for implementation after this review-correction analysis record is committed.**

The review finding is valid and merge-blocking. The set-based prepared authorizer preserves permission semantics while bounding candidate reads and removing per-document database query amplification. No production deployment is authorized. The security freeze remains active and P0-4 remains accepted and unchanged.
