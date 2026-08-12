# W1-2 Session Resolve Route Conversion Validation

- **Date:** 2026-08-12
- **Unit:** W1-2 Unit 5, session resolve read conversion
- **Starting main:** `918307ca24454fd5bc0586bbbe2355a512cafe16`
- **Analysis commits:** `df008e2`, `87afe4a`
- **Implementation commit:** `0820a781685b354c23d60fd3c4bdb3fe0394d2dd`
- **Branch:** `agent/w1-2-session-route-conversion-v1`
- **Status:** Locally validated, not merged, not deployed

## 1. Outcome

The session resolve conversion is ready for draft PR review. The implementation grants the runtime
role EXECUTE on exactly `public.bootstrap_session_resolve_v1(text)` and routes the two authoritative
session read helpers through `BootstrapRepository.resolveSession`.

The login function remains executable by the runtime role. The organization function remains
inaccessible to the runtime role. Session creation, activity refresh, logout, invalidation,
password-reset revocation, and other mutation paths remain on their established paths.

No Unit 5 production mutation, merge, deployment, CloudVault access, Brightside access, Key Vault
operation, Azure mutation, admin URL removal, W1-3 enforcement, or P0-4 change occurred during this
implementation.

## 2. Versioned analysis gate

The implementation followed two committed analysis records:

1. `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md` fixed the route, ACL, migration,
   testing, rollback, and exclusion boundaries before code changes.
2. `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md` preserved those boundaries and
   clarified that a server-component operational repository error propagates to the existing error
   boundary instead of being hidden as an ordinary login redirect.

The v2 record also made the cache contract explicit: PostgreSQL remains authoritative for every
session acceptance. Redis may accelerate mapping but does not authorize a session by itself.

## 3. Exact implementation scope

### 3.1 Fail-closed runtime grant

Migration `20260812163000_w1_2_session_route_conversion`:

- verifies the bootstrap owner is `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`,
  `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION`;
- rejects any pre-existing owner membership edge;
- resolves exactly `public.bootstrap_session_resolve_v1(text)`;
- pins owner, language, `SECURITY DEFINER`, volatility, parallel posture, search path, function body
  MD5, and contract comment;
- requires the pre-grant session function ACL to be owner-only;
- validates the runtime role posture and rejects runtime reachability to the owner;
- uses bounded temporary migrator membership only to apply the exact function grant, then revokes
  that membership in the same transaction;
- verifies zero residual owner membership;
- requires runtime EXECUTE on login and session only;
- requires runtime denial on the organization function; and
- rejects every unexpected EXECUTE grantee.

### 3.2 Runtime session reads

`validateSession` now:

- treats `BootstrapRepository.resolveSession` as authoritative for every accepted session;
- rejects a null projection even when Redis contains a prior complete snapshot;
- compares cached and live session, user, organization, role, management flags, and expiry fields;
- replaces a mismatched cached projection with the live projection;
- keeps cache cleanup failure non-fatal and categorical;
- keeps the established five-minute throttled activity refresh; and
- leaves the activity update on the established mutation path.

`getServerComponentSession` now:

- reads the cookie as before;
- resolves one minimal constrained session projection;
- maps that projection to the established shell shape;
- returns null for an unresolved session; and
- propagates an operational repository error to the existing server error boundary.

Neither converted read helper imports or calls `bootstrapDb` for authoritative reads.

### 3.3 Explicitly unchanged paths

The implementation does not convert or grant additional capability for:

- session creation;
- session activity mutation;
- logout or invalidation;
- password-reset revocation;
- membership-change revocation;
- organization resolution or branding;
- custom-domain middleware;
- two-factor completion;
- registration;
- viewer-link sessions;
- public links;
- the web entrypoint or migrator architecture;
- `DATABASE_URL_ADMIN` removal;
- W1-3; or
- P0-4.

## 4. Validation results

### 4.1 Focused unit tests

Command:

```text
npx vitest run src/lib/auth/session.test.ts \
  src/lib/auth/serverComponentSession.test.ts \
  src/lib/auth/bootstrapRepository.test.ts \
  src/lib/middleware/auth.test.ts
```

Result: **PASS**, 4 files and 41 tests.

Coverage includes:

- live constrained verification of a complete cache entry;
- denial after live revocation;
- malformed, stale-version, expired, inactive, and cache-unavailable fallbacks;
- complete projection caching;
- cache replacement after role or permission changes;
- throttled activity refresh continuity;
- server-component no-cookie and neutral no-row behavior;
- established shell projection mapping; and
- operational repository error propagation.

### 4.2 Full unit suite

Command:

```text
npm test -- --reporter=dot
```

Result: **PASS**.

- Test files: 142 passed, 1 skipped
- Tests: 1,346 passed, 7 skipped
- Duration: 10.47 seconds

The suite emitted expected negative-path test logging and existing React test warnings. It had no
test failures.

### 4.3 Fresh PostgreSQL 15 migration and integration matrix

Disposable target: `vaultspace-w1-2-session-route-v1`, PostgreSQL 15, local port `32769`.

Results:

- all 45 migrations applied;
- guarded RLS setup succeeded with the exact login-plus-session grant matrix;
- focused bootstrap login, session, and organization tests passed, 15 of 15;
- complete integration matrix passed, 7 files and 69 of 69 tests;
- RLS integration passed, 39 of 39;
- provider final evidence passed, 7 of 7;
- authorization room scope passed, 7 of 7;
- login bootstrap passed, 7 of 7;
- session bootstrap passed, 4 of 4;
- organization bootstrap passed, 4 of 4; and
- link admission concurrency passed, 1 of 1.

The first complete integration invocation intentionally failed only the required setup guard because
`ALLOW_RLS_TEST_DB_SETUP=true` was omitted. No test or code was changed. The guarded command was then
run with the required flag and passed 69 of 69.

### 4.4 Azure-like constrained migrator validation

Disposable target: `vaultspace-w1-2-session-route-azure-v1`, PostgreSQL 15, local port `32770`.

The synthetic migrator was non-superuser with `CREATEROLE` and `CREATEDB`. The runtime app role
existed before the migration sequence, matching the important production condition.

The full from-zero sequence stopped at the already-applied Unit 4 login grant migration because that
historical migration does not use temporary owner membership in this synthetic posture. The new Unit
5 migration had not executed at that point. No existing migration was changed or papered over.

To isolate the new migration:

1. the prior login grant was established using the synthetic owner-membership path;
2. that temporary membership was revoked;
3. the new Unit 5 migration was executed directly as the constrained migrator; and
4. the final catalog posture was queried.

Result: **PASS** for the new Unit 5 migration.

- login EXECUTE: true
- session EXECUTE: true
- organization EXECUTE: false
- residual bootstrap-owner memberships: zero
- session function body MD5: `bb08b359335ac3b07abbf7cf50c4708d`

The historical from-zero portability observation is recorded as a separate residual concern. It is
not changed by this unit and does not affect the already-applied production Unit 4 migration or the
directly proven Unit 5 migration.

### 4.5 Repository-wide checks

| Check                  | Result                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `npm run lint`         | PASS, zero errors and one pre-existing unrelated hook warning |
| `npm run type-check`   | PASS                                                          |
| `npm run format:check` | PASS                                                          |
| `npm run build`        | PASS                                                          |
| `git diff --check`     | PASS                                                          |

The build completed all 37 static pages and the complete application route inventory.

## 5. Unit 4 evidence follow-up

The Advisor-authorized Unit 4 evidence PR was merged before Unit 5 implementation publication:

- PR: `#134`
- exact PR head: `53ccab37ba9f5d18e41df241fc0870f26d3e6f27`
- merge SHA: `918307ca24454fd5bc0586bbbe2355a512cafe16`
- exact-main CI: `31617040764`, success
- automatic docs-only successor deploy: `31617692795`, success
- live release: `918307ca24454fd5bc0586bbbe2355a512cafe16`
- live web revision: `ca-vaultspace-web--0000290`
- quick health: healthy, no degraded checks

The automatic deploy was triggered by the active workflow after exact-main CI. It was not a manual
dispatch. Its migration, worker, job, health, web convergence, traffic, and final worker readiness
gates all passed. Unit 4 remains acceptance-closed.

## 6. Retained local validation objects

The following local-only disposable objects are intentionally retained pending explicit cleanup
approval:

- `vaultspace-w1-2-session-route-v1`
- `vaultspace-w1-2-session-route-azure-v1`

The following accidental or diagnostic temporary files outside the workspace are also retained
pending explicit deletion approval:

- `/tmp/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.seed`
- `/tmp/vaultspace-unit5-docs-health-headers.out`

No credential material or customer data is contained in those listed temporary files.

## 7. Production gate

This validation does not authorize merge or deployment. A later Advisor GO must still govern:

1. human review and exact-head PR CI;
2. controlled merge with deployment workflow disabled;
3. exact-main CI and image publication;
4. workflow re-enable without side-effect deployment;
5. exactly one dispatch for the exact post-merge SHA;
6. production catalog verification;
7. full CloudVault session-family acceptance;
8. minimal read-only Brightside smoke only after CloudVault is green;
9. rollback on any session or Brightside failure; and
10. versioned deployment evidence and written Unit 5 close-out.

The admin URL must remain present. The organization function must remain runtime-inaccessible. W1-3
must remain unenforced. P0-4 remains accepted and unchanged.

## 8. Status stamp

**W1-2 UNIT 5 SESSION RESOLVE CONVERSION: LOCALLY VALIDATED, DRAFT-PR READY, NOT MERGED, NOT
DEPLOYED.**

W1-2 Units 1 through 4 remain acceptance-closed. Live production remains the healthy docs-only Unit
4 successor at `918307ca... / ca-vaultspace-web--0000290`. W1-2 overall remains OPEN. Runtime
EXECUTE in production remains login-only until a later authorized Unit 5 deployment. The public web
admin URL remains present. W1-3 remains not started. The security freeze remains active.

## References

- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `prisma/migrations/20260812020000_w1_2_session_bootstrap_foundation/migration.sql`
- `prisma/migrations/20260812163000_w1_2_session_route_conversion/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `scripts/setup-rls-test-db.ts`
- GitHub PR `#134`
- GitHub Actions runs `31617040764` and `31617692795`
