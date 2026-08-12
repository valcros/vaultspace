# W1-2 Organization Bootstrap Foundation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive organization-resolve foundation
- **Status:** Analysis complete, implementation authorized under Option A
- **Governing design:** W1-2 Database Privilege Split Design
- **Dependencies:** W1-2 Units 1 and 2 acceptance-closed
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Decision summary

Prepare the next W1-2 unit as one additive organization-resolution capability that remains inert in
production:

1. Reuse the existing `vaultspace_bootstrap_owner` `SELECT` privilege on `public.organizations`.
2. Add one exact SECURITY DEFINER function that resolves an active organization by an explicit
   lookup kind and canonical value.
3. Support only the two existing pre-tenant lookup contracts: organization slug and custom domain.
4. Return only organization identity and fields already exposed by the public branding endpoint.
5. Revoke function execution from `PUBLIC` and withhold execution from `vaultspace_app`.
6. Extend the typed `BootstrapRepository` through the ordinary runtime `db` client.
7. Add unit and real PostgreSQL tests for lookup isolation, projection, hostile input, inactive
   organizations, exact catalog posture, and owner-only execution.
8. Do not convert custom-domain middleware, request-context resolution, public branding, forgot
   password, or any other route in this unit.

This is the lowest-blast-radius Option A capability. Unlike session mutation and password-reset
work, it requires no new owner table privilege, no write authority, no locking contract, and no
credential-bearing projection.

## 2. Current behavior and reason for this unit

Several public and pre-session paths must identify an organization before an RLS organization
context exists:

- `resolveCustomDomain` looks up an active organization by `customDomain`;
- `resolveSubdomain` looks up an active organization by `slug`;
- `resolveOrganizationFromHeaders` tries an organization slug and then a custom host;
- `/api/public/branding` resolves the organization and then performs a second bootstrap read for
  name and public branding; and
- later password-reset sender selection may use the request organization slug.

Those paths currently use `bootstrapDb`, which selects through the public web admin connection.
The governing design requires a narrow, typed organization-resolution capability before that
credential can be removed.

This foundation does not alter any of those callers. It creates and proves the database contract
first, keeping the existing behavior and rollback path unchanged.

## 3. Exact implementation boundary

### 3.1 Function signature

The proposed exact signature is:

`public.bootstrap_organization_resolve_v1(text, text)`

Arguments:

1. `input_lookup_kind`: exactly `SLUG` or `CUSTOM_DOMAIN`.
2. `input_lookup_value`: one already-canonical lookup value.

The function returns at most one active organization. Invalid kinds, empty values, oversized
values, malformed values, unknown values, and inactive organizations all return no row.

The function does not normalize or extract hostnames. Application code owns request-header parsing,
port removal, main-domain exclusion, lowercase normalization, and selection of the lookup kind.
Keeping those rules outside the SECURITY DEFINER function prevents request parsing from becoming a
database privilege boundary.

### 3.2 Lookup rules

For `SLUG`:

- length is 1 through 100 characters;
- characters are lowercase ASCII letters, numbers, and hyphens only;
- the value is compared to `organizations.slug`; and
- `isActive` must be true.

For `CUSTOM_DOMAIN`:

- length is 1 through 255 characters;
- the value is a lowercase ASCII hostname with no scheme, path, query, fragment, credentials,
  whitespace, or port;
- characters are limited to lowercase letters, numbers, dots, and hyphens;
- the value is compared to `organizations.customDomain`; and
- `isActive` must be true.

The repository trims and lowercases the caller input and rejects invalid shapes before querying.
The database function repeats the kind, length, and shape constraints so a future direct caller
cannot bypass them.

### 3.3 Result projection

The function returns only:

- organization ID;
- organization name;
- organization slug;
- custom domain, when configured;
- logo URL;
- primary color; and
- favicon URL.

These branding fields are already returned by `/api/public/branding`. The function does not return:

- email sender name or address;
- audit or retention settings;
- storage limits;
- membership, user, room, document, link, or access-request data;
- credentials or tokens; or
- any inactive organization.

The typed repository returns one immutable organization projection or `null`. It fails closed on a
duplicate row, an invalid ID or slug, an invalid color, an unexpected custom-domain value, or any
undocumented result shape.

### 3.4 Migration posture

The additive migration will:

- verify the existing owner has the exact constrained role attributes;
- prove the runtime role cannot reach or assume the owner;
- verify the owner's table privileges remain exactly `SELECT` on `organizations`, `sessions`,
  `user_organizations`, and `users`;
- create one static SQL function with fully qualified object references;
- set `search_path` to `pg_catalog`;
- revoke all function execution from `PUBLIC` and any pre-existing runtime grant;
- transfer ownership through temporary migrator membership, then revoke that membership;
- pin a versioned contract comment and source checksum; and
- abort the transaction if the final function, role, privilege, or ACL posture is not exact.

The migration will not:

- grant a new table or sequence privilege to the owner;
- grant runtime execution;
- alter organization rows or public branding data;
- enable or FORCE RLS;
- remove an existing bootstrap policy;
- create a role credential or Key Vault secret;
- edit an applied migration; or
- change Azure, the entrypoint, or a deployment workflow.

## 4. Security invariants

All of these must be proved before the unit is reviewable:

1. `vaultspace_bootstrap_owner` keeps its exact constrained role attributes.
2. The runtime role cannot reach, inherit, or assume the owner.
3. The owner gains no table, sequence, schema-create, or write privilege.
4. The new function has one exact signature and no overload.
5. Function ownership, language, SECURITY DEFINER state, volatility, parallel mode, search path,
   comment, source checksum, and ACL are exact.
6. `PUBLIC` and `vaultspace_app` cannot execute the function in the foundation posture.
7. A temporary exact runtime grant can call only the reviewed function during disposable testing.
8. The lookup kind cannot become a SQL identifier or dynamic expression.
9. The lookup value is a bound parameter and cannot manipulate SQL or caller search path.
10. Slug lookup cannot return a custom-domain-only match and custom-domain lookup cannot return a
    slug-only match.
11. An inactive organization returns the same neutral no-row result as an unknown organization.
12. No private configuration or tenant data is present in the result projection.
13. No production route imports or calls the new repository method.
14. Existing login and session bootstrap functions retain owner-only execution and their exact
    catalog posture.

## 5. Verification plan

### 5.1 Static and unit checks

- Prove lookup kind and value are separate bound parameters.
- Prove slug and custom-domain inputs are trimmed and lowercased.
- Prove malformed, ambiguous, oversized, URL-shaped, port-bearing, whitespace-bearing, and empty
  values return `null` without querying PostgreSQL.
- Prove zero rows return `null` and duplicate rows fail closed.
- Prove incomplete or malformed projections fail closed without logging the row.
- Prove only documented fields appear in the typed result.
- Prove no route or middleware import uses the new method.
- Prove the diff contains no runtime grant, `DATABASE_URL_ADMIN`, entrypoint, workflow, Azure, Key
  Vault, W1-3, or P0-4 change.

### 5.2 Disposable PostgreSQL integration

Run all migrations and RLS setup against fresh PostgreSQL 15, then prove:

- exact owner attributes and recursive runtime non-reachability;
- the exact pre-existing four-table `SELECT` set and no new owner privilege;
- exact function signature, result columns, owner, language, SECURITY DEFINER state, volatility,
  parallel mode, search path, comment, source checksum, and owner-only execution ACL;
- direct runtime and `PUBLIC` execution denial;
- one temporary exact runtime grant permits the reviewed function only;
- active slug and active custom-domain lookups return the exact minimal projection;
- a hostile caller search path does not change the result;
- unknown kind, cross-kind lookup, malformed input, SQL-shaped input, inactive organization, and
  unknown organization all return no row;
- no email-sender, retention, storage, membership, room, document, or credential fields are
  projected; and
- the temporary runtime grant is revoked before transaction completion.

The existing login-candidate and session-resolve integration suites must remain green.

### 5.3 Not part of this unit

- Runtime execute grant.
- Route, middleware, public-branding, or forgot-password conversion.
- Domain parsing or request-header behavior changes.
- Session refresh, invalidation, or cache changes.
- Password-reset, registration, 2FA, public-link, viewer-session, or access-request functions.
- One-shot migrator job or web entrypoint changes.
- `DATABASE_URL_ADMIN` removal.
- W1-3 policy removal or production FORCE changes.

## 6. Strawman

### Why add a function for data that is already public?

The branding values are public, but finding the tenant is a pre-context database operation. The
current public web process performs it with a broadly privileged connection. Public output does not
justify broad database authority inside an internet-facing process.

### Why not grant direct organization-table SELECT to the runtime role?

The organization table also contains non-public configuration, sender identity, retention, and
storage fields. Direct table SELECT would let an unintended query retrieve more than the public
projection. The function restricts both lookup predicates and returned columns.

### Why not route the public-branding endpoint in this unit?

The current header parsing has separate slug and host paths, main-domain exclusions, and graceful
error behavior. Converting those paths at the same time as introducing the database boundary would
mix catalog review with customer-visible routing behavior. The inert foundation keeps those risks
separate.

### Why not choose session mutation next?

Session mutation would require new owner write privilege and careful categorical or token-fingerprint
results for cache invalidation. Organization resolution achieves useful W1-2 progress without
adding write authority. Session mutation remains a later separately analyzed unit.

## 7. Steelman

- This capability removes no existing safety net and changes no live request behavior.
- It adds no owner table privilege because Unit 1 already granted the required organization read.
- The function exposes only fields that the public branding route already returns.
- Explicit lookup kinds prevent a slug from accidentally matching a custom domain or vice versa.
- Typed validation and PostgreSQL catalog tests create a narrow, reviewable contract for a later
  routed conversion.
- Owner-only execution ensures the function cannot be used by the runtime until that conversion
  receives a separate review and CloudVault plan.

## 8. Pre-Mortem

Assume this foundation caused an incident.

### Failure: a malformed host resolves another organization

Likely cause:

- a scheme, port, path, Unicode lookalike, or mixed-case value was accepted unexpectedly;
- lookup kinds were combined in one permissive predicate.

Detection:

- repository and PostgreSQL negative tests for malformed and cross-kind values;
- exact-name fixtures for slug and custom-domain collisions;
- no dynamic SQL.

Rollback:

- keep runtime execution withheld;
- correct the function through a new additive migration;
- do not route callers or grant direct organization-table access.

### Failure: private organization configuration is exposed

Likely cause:

- a table-row return type or `SELECT *` was used;
- email-sender, retention, or storage columns entered the projection.

Detection:

- exact named result-column catalog assertion;
- repository key-shape tests;
- protected-column source checks and pinned checksum.

Rollback:

- leave the function inert;
- replace it through a reviewed migration before any runtime grant.

### Failure: the migration broadens owner or runtime authority

Likely cause:

- an unnecessary table grant was added;
- temporary ownership membership was not revoked;
- runtime execute or `PUBLIC` execute survived migration.

Detection:

- exact pre- and post-migration privilege arrays;
- recursive reachability check;
- exploded function ACL verification;
- real-role disposable integration.

Rollback:

- the transaction fails before commit when posture is wrong;
- if drift is found after deployment, keep the function unrouted and correct it through a reviewed
  migration rather than ad hoc production DDL.

### Failure: an inactive tenant becomes publicly discoverable

Likely cause:

- the active predicate was omitted from one lookup kind.

Detection:

- inactive slug and custom-domain fixtures return no row;
- source checksum and exact SQL review.

Rollback:

- runtime execution remains withheld, so no application path depends on the function;
- correct the predicate through a new migration.

## 9. Rollback and deployment posture

Before merge, rollback is closing the draft or abandoning the branch.

If the additive migration is later approved and applied:

- retain the prior web and worker revisions and images;
- keep `PUBLIC` and runtime execute revoked;
- keep all current organization-resolution paths unchanged;
- do not edit or reverse an applied migration during immediate application rollback; and
- correct any catalog defect through a new reviewed migration.

Because no production caller uses the function, the database object can remain inert while a
correction is reviewed. A controlled deployment must still verify migration completion, exact live
catalog posture, coherent workloads, quick uncached health, and the existing bounded CloudVault
login smoke.

## 10. Go or no-go

**GO to implement the inert organization-resolve foundation on a draft branch.**

**NO-GO for runtime execute, route conversion, admin URL removal, W1-3 enforcement, or deployment
without the established controlled merge and deployment gate.**

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/middleware/customDomain.ts`
- `src/lib/middleware/auth.ts`
- `src/app/api/public/branding/route.ts`
