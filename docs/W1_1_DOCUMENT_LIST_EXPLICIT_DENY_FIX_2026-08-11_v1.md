# W1-1 Document List Explicit-Deny Fix

- **Date:** 2026-08-11
- **Status:** Analysis complete, implementation authorized after this record is committed
- **Decision owner:** Stakeholder Advisor
- **Control family:** W1-1 room-scoped authorization
- **Production baseline during implementation:** W0
- **Deployment status:** Not authorized

## 1. Decision summary

Fix `DocumentService.list()` so its items, total, offset, pagination, and `hasMore` values are computed only from documents the authenticated actor may VIEW after the complete W1-1 deny-resolution algorithm runs.

The current room-level gate remains necessary but is not sufficient. After it passes, the service will load only the identifiers and folder identities of documents matching the requested room, folder, status, category, and search filters. It will evaluate those candidates as DOCUMENT resources through `PermissionEngine` inside the same organization-scoped transaction, in bounded batches. The authorized candidate set will be established before the total and requested page are selected. Only the authorized page identifiers will be used to fetch response rows and versions.

An explicit document `NONE`, an inheritable ancestor-folder `NONE`, or another applicable non-admin deny must remove the document from both items and total. A sibling document that remains allowed must remain visible. Direct document access continues to return non-disclosing 404 behavior when authorization denies.

## 2. Observed failure

The CloudVault W1-1 acceptance matrix proved this sequence:

1. A synthetic viewer received room VIEW.
2. A document in that room received an explicit user-level `NONE` decision.
3. Direct document access returned 404 as intended.
4. The room document-list endpoint still returned and counted the denied document.

Repository inspection confirms the cause. `DocumentService.list()` authorizes the ROOM once and then sends the unmodified tenant and room `where` clause directly to `document.count()` and `document.findMany()`. No document-level decision occurs before count, offset, or limit.

This is a discovery leak within an otherwise viewable room. It is not evidence of cross-organization access, but it violates explicit-deny precedence and the approved W1-1 authorization contract.

## 3. Implementation boundary

Authorized files are expected to be limited to:

- `src/services/DocumentService.ts`
- `src/services/DocumentService.test.ts`
- `tests/integration/authorization-room-scope.test.ts`
- this analysis record

No PermissionEngine semantic change, schema change, migration, link-policy change, pipeline change, RLS change, malware behavior, networking change, customer communication, or production deployment is included.

## 4. Detailed design

### 4.1 Room gate

Keep the existing room VIEW check. If it denies, throw `NotFoundError('Room not found')` before any document candidate query.

### 4.2 Candidate selection

Build the existing tenant, room, folder, status, category, and search predicate without weakening it. Query candidate document identities using that predicate and a deterministic order. Select only the fields required for authorization and ordering, including `id` and `folderId`.

The candidate query does not expose rows to the caller. It is an internal authorization input inside `withOrgContext()`.

### 4.3 Authorization before total and pagination

Resolve every candidate as:

```text
Actor: authenticated session user
Action: view
Resource: DOCUMENT
Tenant: session organization
Room: requested room
Folder: candidate folder, when present
Document: candidate id
```

Use bounded Promise batches so a large room does not start an unbounded number of concurrent permission queries. Reuse the existing PermissionEngine rather than reproducing deny, group, administrator, inheritance, expiry, or revocation logic in the service.

Filter the ordered candidate list by those decisions. Then:

- `total` is the number of authorized candidates;
- page identifiers are `authorized.slice(offset, offset + limit)`;
- response rows are fetched only for those page identifiers;
- response order follows the authorized page order;
- `hasMore` compares the authorized offset and item count to the authorized total.

The implementation must not query a raw total before authorization and must not filter response rows after applying database `skip` and `take`.

### 4.4 Search behavior

The existing full-text candidate lookup may find denied document identifiers internally. The final candidate set must still pass document authorization before it affects total or pagination. Search fallback behavior is unchanged.

### 4.5 Direct access

`DocumentService.getById()` already evaluates the complete DOCUMENT resource and returns `null` on deny. The direct route already maps denied or missing documents to 404. Tests will pin that contract while the list behavior is corrected.

## 5. Verification plan

### Unit tests

- Room VIEW plus document `NONE` excludes that document from items and total.
- The allowed sibling remains in items and total.
- Authorization decisions occur before page selection.
- A denied document on the first raw page cannot create a sparse page or inflate `hasMore`.
- The final response preserves authorized candidate order.
- Room denial still prevents all document candidate and response queries.

### Runtime-role integration tests

Using the existing synthetic two-organization fixture:

- grant room VIEW to a non-admin viewer;
- add document-level `NONE` to one document;
- assert the folder list returns only the allowed sibling and total equals one;
- assert direct service lookup for the denied document returns `null`, which the route maps to 404;
- assert direct lookup for the sibling succeeds;
- add an inheritable parent-folder `NONE` and assert the nested document is excluded from list and direct access;
- keep cross-tenant and inactive-membership behavior unchanged.

### CloudVault after a separate deploy GO

Repeat only the synthetic document override cases that failed. Do not use Brightside for authorization testing. A production deploy is not part of this work item.

## 6. Rollback

This fix has no data migration. Before production deployment, the prior W0 and W1 images and revisions remain retained. If a future authorized deployment causes list failures or incorrect totals, restore the prior approved web revision and keep W1-1 open.

Rolling back this code reintroduces the known list discovery defect. The freeze therefore remains active until a corrected revision passes CloudVault.

## 7. Strawman

### What if the finding is product intent, not a bug?

One interpretation is that room VIEW intentionally exposes all document names while document `NONE` blocks only direct content access. That interpretation conflicts with the approved explicit-deny contract, non-discovery behavior, and direct-route 404 policy. It would also make the list total disclose denied resources. The Advisor has confirmed this as a merge-blocking authorization defect.

### What simpler control achieves most of the reduction?

Filtering only returned items after pagination is smaller, but it produces sparse pages, incorrect totals, and count disclosure. Removing denied rows from the final response without recomputing `hasMore` also remains incorrect. The smallest coherent fix is authorization before total and page selection.

### What workflow might break?

- A room viewer may see fewer document rows than before when explicit leaf or inherited denies exist.
- Pagination may shift because denied documents no longer consume page slots.
- A caller that assumed total represented every room document may observe a lower, actor-specific total.
- Large rooms may incur extra permission-query latency.

These are either intended security effects or measurable performance risks. Bounded batches and focused service tests control the implementation risk.

### Are we over-optimizing for multi-tenant behavior while Brightside is single-room?

The defect occurs within a single room and does not depend on multiple rooms or organizations. Brightside is not used to test it, but the control is directly relevant to any room containing document overrides.

## 8. Steelman

### Blast radius if unfixed

Any non-admin viewer with room VIEW can discover the name and existence of a document explicitly denied to that viewer. Search, folder listing, totals, and pagination can reveal denied-document presence even though direct access returns 404.

### Defense-in-depth failure

The permission engine makes the correct deny decision, but the list bypasses it. A green direct-route test therefore gives false confidence while a parallel discovery endpoint leaks the resource. Enforcing the same decision before list totals closes this inconsistent control path.

### Contract alignment

The fix implements explicit deny, inheritable ancestor deny, authorization before count and pagination, non-discovery, and a single authorization source. It does not invent a second ACL interpretation.

### Cost of delay versus careful fix

The code change is bounded to one service path and tests, with no migration or production data rewrite. Leaving the defect live would knowingly retain an authorization contract break that CloudVault already reproduced.

## 9. Pre-Mortem

Assume the fix caused an incident.

### Failure: document lists become empty for valid viewers

Likely cause: the resource tuple omits the folder identity, uses the wrong organization, or evaluates before loading persisted membership and groups.

Detection:

- unit test for an allowed sibling;
- runtime-role integration test with room VIEW;
- CloudVault synthetic folder list before any Brightside smoke.

Rollback:

- restore the prior web revision;
- do not bypass PermissionEngine or add an organization VIEWER fallback.

### Failure: pagination is slow or times out

Likely cause: unbounded concurrent authorization calls or repeated folder-lineage queries in a large room.

Detection:

- assert bounded batch execution in unit tests;
- record target test duration;
- review query shape before merge.

Rollback:

- restore the prior revision if user-visible latency breaches the operational budget;
- optimize batch resolution without weakening deny semantics.

### Failure: totals are still wrong

Likely cause: raw `document.count()` remains before authorization, or page filtering occurs after `skip` and `take`.

Detection:

- a denied first candidate plus allowed later sibling test;
- assert total, item IDs, and `hasMore` together.

Rollback:

- block merge or restore the prior revision; do not accept a partial item-only filter.

### Failure: organization or room administrators lose access

Likely cause: the service introduces separate deny logic instead of reusing PermissionEngine authority ordering.

Detection:

- existing PermissionEngine administrator tests;
- service test using an allowed administrator decision.

Rollback:

- remove the duplicate service logic and rely on the engine.

### False confidence from green tests

Mocked boolean decisions alone do not prove folder inheritance or runtime-role behavior. Acceptance therefore requires the existing PostgreSQL synthetic fixture in addition to unit tests.

## 10. Go or no-go

**GO for implementation after this analysis record is committed.**

Steelman justifies the bounded correction. The pre-mortem has a reversible code-only rollback, tests for the observed failure, and no production deployment authorization. The security freeze remains active and P0-4 remains accepted and unchanged.

