# W1-2 Session Resolve Route Conversion

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Session-resolve runtime grant and read-path conversion
- **Prerequisite:** W1-2 Unit 4 acceptance-closed
- **Starting main:** `918307ca24454fd5bc0586bbbe2355a512cafe16`
- **Production before implementation:** `831f4a72be960dbcb2e3841df83ee008ffda95e2` /
  `ca-vaultspace-web--0000289`
- **Status:** Analysis-first record, no production change

## 1. Decision

Convert the ordinary authenticated session read path to the already-live
`public.bootstrap_session_resolve_v1(text)` function and grant `vaultspace_app` EXECUTE on that
exact signature only.

The coherent read-only slice includes:

- the authoritative database resolution used by `validateSession`;
- the security-critical live check performed before accepting a cached session; and
- the server-component session resolution used by the authenticated shell and dashboard.

The slice deliberately excludes session mutation. Sliding activity refresh, logout, explicit
invalidation, password-reset revocation, membership-change revocation, and cache deletion remain on
their established mutation paths. This unit does not claim that those mutation paths are converted.

## 2. Current-state inventory

### 2.1 Existing foundation

W1-2 Unit 2 deployed the exact function and typed repository method without runtime execution:

- function: `public.bootstrap_session_resolve_v1(text)`;
- owner: `vaultspace_bootstrap_owner`;
- contract: `vaultspace-contract:w1-2-session-resolve-v1`;
- stored source SHA-256:
  `7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916`;
- owner table privileges: SELECT only on `organizations`, `sessions`, `user_organizations`, and
  `users`;
- `PUBLIC` EXECUTE: denied;
- `vaultspace_app` EXECUTE: denied; and
- typed caller: `BootstrapRepository.resolveSession` through the ordinary runtime `db` client.

The function already enforces token shape, exact token match, active session, idle expiry,
seven-day absolute expiry, active user, active membership, active organization, and organization
binding. It returns the complete minimal `SessionData` projection plus last-activity time.

### 2.2 Runtime read paths

`src/lib/auth/session.ts` currently performs two privileged session reads:

1. A cached-session live-state check by session ID through `bootstrapDb.session.findUnique`.
2. A cache-miss resolution by token through `bootstrapDb.session.findUnique`, followed by a
   separate organization-context membership lookup.

`src/lib/auth/serverComponentSession.ts` separately reads the session, user, organization, and
membership through three `bootstrapDb` queries for the authenticated layout and dashboard.

All API and server middleware session reads flow through `validateSession`, `getSession`, or
`getSessionFromRequest`. The server-component helper is the only separate application-session
read path found in the inventory.

### 2.3 Mutation paths kept unchanged

The following stay outside this unit:

- `createSession`;
- `refreshSessionActivity`;
- `invalidateSession`;
- `invalidateAllUserSessions`;
- transaction-scoped user or organization session deactivation;
- logout audit handling;
- password-reset session invalidation; and
- Redis cache deletion.

This boundary keeps the already-reviewed read-only SQL function stable and avoids combining
read-path conversion with a new write-capable SECURITY DEFINER surface.

## 3. Exact implementation contract

### 3.1 Migration

Add one forward-only migration that:

1. Fails closed unless `vaultspace_bootstrap_owner` has its exact NOLOGIN, NOINHERIT,
   NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, and NOREPLICATION posture.
2. Fails closed if the owner has any role membership or is reachable by `vaultspace_app`.
3. Resolves exactly one `bootstrap_session_resolve_v1(text)` function.
4. Verifies its identity arguments, owner, SQL language, SECURITY DEFINER flag, stable volatility,
   restricted parallel mode, `search_path=pg_catalog`, contract marker, and stored source checksum.
5. Fails closed if any non-owner role already has EXECUTE before the grant.
6. Grants EXECUTE only to `vaultspace_app` on
   `public.bootstrap_session_resolve_v1(text)`.
7. Verifies login and session EXECUTE are present while organization EXECUTE remains denied.
8. Verifies `PUBLIC` remains denied and no unexpected ACL row exists.

The migration does not create, replace, or alter the function body or owner privileges.

### 3.2 `validateSession`

Use one `BootstrapRepository` instance backed by the ordinary `db` client.

- On a valid cache entry, call `resolveSession(token)` before accepting the snapshot.
- Accept the cache only when the live projection matches the cached session ID, user ID,
  organization ID, expiry, active user, and organization membership projection required for
  authorization.
- Delete a rejected cache entry and continue to the same authoritative repository read result.
- On a cache miss, malformed entry, cache failure, or rejected cache entry, use
  `resolveSession(token)` as the authoritative read.
- Map a null result to the established neutral `AuthenticationError('Invalid session')` behavior.
- Cache only the complete mapped projection.
- Preserve the existing throttled sliding-activity refresh after a successful authoritative read.

The function already filters idle-expired, absolute-expired, inactive-user, inactive-membership,
inactive-organization, unbound, revoked, and malformed-token cases into a neutral no-row result.
This conversion must not reintroduce separate direct-table reads to distinguish those cases.

### 3.3 Server components

Replace the three-query `bootstrapDb` implementation in
`src/lib/auth/serverComponentSession.ts` with the same `BootstrapRepository.resolveSession` call.
Map the repository projection to the existing server-component return shape so the layout and
dashboard retain:

- `session.id` and `session.userId`;
- non-null `session.organizationId`;
- user display and identity fields;
- organization ID, name, and slug; and
- membership role.

Do not add branding fields or organization-resolution calls to this helper. The authenticated
layout continues to load its optional logo through `withOrgContext` after the session establishes
the organization boundary.

### 3.4 Logging and errors

- Do not log session tokens, token hashes, session IDs, user IDs, organization IDs, email
  addresses, SQL text, database codes, or exception messages.
- Normal invalid, expired, revoked, or malformed sessions remain neutral and unlogged.
- Operational repository failures fail closed through existing middleware behavior.
- Any new diagnostic log must be categorical JSON only and requires a regression test.

## 4. Test requirements

### 4.1 Migration and catalog

- Migration succeeds on a fresh PostgreSQL 15 database.
- Azure-like constrained migrator path succeeds.
- Exact session function posture and checksum remain unchanged.
- `vaultspace_app` EXECUTE matrix is login yes, session yes, organization no.
- `PUBLIC` remains denied.
- Persistent unexpected ACL, owner drift, source drift, overload, or runtime reachability aborts the
  migration.
- Direct table SELECT by the runtime role remains denied without tenant context.

### 4.2 Repository-backed runtime session tests

- Cache miss returns the mapped repository projection.
- Valid cache is accepted only after a matching live repository projection.
- Revoked, expired, inactive-user, inactive-membership, inactive-organization, and unbound
  sessions return neutral authentication denial.
- A mismatched session, user, organization, or membership projection rejects the cache.
- A rejected cache entry is deleted.
- Malformed tokens are rejected without a PostgreSQL call.
- Cache failure falls back to repository resolution.
- A successful old-enough session still schedules the existing activity refresh.
- No read path imports or calls `bootstrapDb`.

### 4.3 Server-component tests

- No cookie returns null without a query.
- Valid repository projection returns the established shell shape.
- Null, malformed, or operationally failed resolution returns null and causes the existing login
  redirect at the layout boundary.
- The helper does not use `bootstrapDb` or perform separate user, organization, or membership
  queries.

### 4.4 Existing regression coverage

- Login-family tests remain green.
- `/api/auth/me` remains green for a valid session.
- Logout invalidates the old session and protected re-entry returns 401 or login redirect.
- Password-reset revocation still defeats a stale cache entry.
- RLS integration, provider inbox, deployment-mode, build, Docker, E2E, and password-reset browser
  paths remain green.

## 5. Production acceptance plan

No production operation is authorized by this analysis record. A later controlled merge and deploy
GO should require:

1. Human review and exact-head PR CI.
2. Temporary disable of workflow `251547585` before merge.
3. Exact-main CI and image publication with no deployment while disabled.
4. Re-enable without side-effect deployment and one dispatch for the exact main SHA.
5. Exact catalog EXECUTE matrix and unchanged owner/function checksum.
6. Coherent web, worker, and three job digests.
7. CloudVault session matrix before Brightside:
   - login and `/api/auth/me`;
   - cached and uncached session load;
   - malformed, unknown, revoked, idle-expired, and absolute-expired token denial;
   - inactive user, membership, and organization denial;
   - activity refresh behavior without forcing excessive live traffic;
   - logout and protected re-entry denial; and
   - login 2FA branch continuity.
8. Only after CloudVault is green, minimal Brightside shell, previously known room, logout, and
   protected re-entry.
9. Versioned evidence and written Advisor close-out.

Retain `ca-vaultspace-web--0000289`, `ca-vaultspace-web--0000288`, and their prior digests through
the next successful unit deploy. Roll back to the prior healthy revision on any session or
Brightside failure. Do not issue a second deployment without a new GO.

## 6. Explicit exclusions

This unit does not:

- add a session mutation SECURITY DEFINER function;
- convert sliding refresh, logout, invalidation, password reset, registration, two-factor
  completion, links, viewer sessions, organization resolution, custom-domain middleware, or
  branding;
- grant EXECUTE on `bootstrap_organization_resolve_v1`;
- remove or rename `bootstrapDb` globally;
- remove `DATABASE_URL_ADMIN` from the web workload;
- change the web entrypoint or migration job architecture;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change P0-4 or malware scanning;
- query Brightside or customer data during implementation; or
- use production `deep=true` health.

## 7. Strawman, Steelman, and Pre-Mortem

### Strawman

- One session function sits under nearly every authenticated API route, so a projection or grant
  mistake can make the entire application appear logged out.
- Moving the cached-session live check to a token-based resolver may add a function call on every
  cached request and erase some performance benefit.
- Keeping refresh and invalidation on the old mutation paths can create a misleading impression
  that the complete session family is converted.

### Steelman

- The function and repository have already been deployed inert, catalog-verified, and regression
  tested through Unit 2.
- One exact owner-only SELECT function can replace multiple privileged pre-context reads while
  returning less data and enforcing user, membership, organization, idle, and absolute-expiry
  state atomically.
- Converting both middleware and server-component reads avoids leaving a hidden privileged session
  lookup behind.
- Keeping writes out of the unit preserves the function's read-only contract and creates a clear
  later boundary for session mutation.

### Pre-Mortem

| If                                                    | Detection                                               | Response                                               |
| ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Runtime receives a broader grant                      | Catalog ACL and `has_function_privilege` matrix         | Fail migration or acceptance; do not route traffic     |
| Cached revoked session is accepted                    | Unit test and CloudVault revoke/logout cases            | Roll back; do not trust cache without live resolver    |
| Session helper returns an incomplete projection       | Mapper and server-component tests                       | Fail closed before merge                               |
| Session refresh stops unexpectedly                    | Focused unit test and bounded CloudVault activity check | Keep refresh on established mutation path or roll back |
| Brightside shell or known room redirects after deploy | Minimal Brightside smoke after CloudVault               | Immediate application rollback and stop                |
| Evidence implies mutation conversion                  | Diff and evidence review                                | Correct status language; admin URL remains present     |

## 8. Status

**W1-2 UNIT 5 SESSION RESOLVE CONVERSION: ANALYSIS RECORDED, NOT IMPLEMENTED, NOT MERGED, NOT
DEPLOYED.**

W1-2 Units 1 through 4 remain acceptance-closed. W1-2 overall remains OPEN.
`DATABASE_URL_ADMIN` remains present. Session and organization EXECUTE remain withheld at the time
of this record. W1-3 remains not started. The security freeze is active. P0-4 remains accepted and
unchanged.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_VALIDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `docs/W1_2_LOGIN_ROUTE_CONVERSION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `prisma/migrations/20260812020000_w1_2_session_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `src/lib/middleware/auth.ts`
- `tests/integration/bootstrap-session-resolve.test.ts`
- PR #134 and merge commit `918307ca24454fd5bc0586bbbe2355a512cafe16`
