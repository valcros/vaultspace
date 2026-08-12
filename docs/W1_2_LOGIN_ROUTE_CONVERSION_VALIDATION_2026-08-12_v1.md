# W1-2 Login Route Conversion Validation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** First routed bootstrap conversion, login candidate only
- **Branch:** `agent/w1-2-login-route-conversion-v1`
- **Status:** Local validation green, draft review pending
- **Production impact:** None from this unit
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Result

The login-candidate routed conversion is prepared and locally green.

The draft:

- grants `vaultspace_app` EXECUTE only on
  `public.bootstrap_login_candidate_v1(text)`;
- keeps `PUBLIC` denied;
- keeps session and organization bootstrap functions owner-only;
- routes `POST /api/auth/login` candidate lookup through
  `BootstrapRepository.findLoginCandidate`;
- removes every `bootstrapDb` reference from the login route;
- preserves rate limiting, bcrypt verification, 2FA temporary-token behavior, org-bound session
  creation, cookie behavior, audit capture, and response fields;
- treats all no-candidate states as one neutral HTTP 401 denial;
- fails closed without admin fallback when the narrow call errors; and
- keeps `DATABASE_URL_ADMIN` and all unconverted families unchanged.

No merge, deployment of this unit, Azure mutation for this unit, Key Vault mutation, CloudVault
test, or Brightside access occurred during this preparation.

## 2. Unit and static validation

The focused route and repository suite passed:

- test files: 2 passed;
- tests: 30 passed after the final route-source assertion was added; and
- failures: 0.

Coverage includes:

- static proof that the login route calls the narrow repository and contains no `bootstrapDb`;
- rate-limit denial before candidate lookup or bcrypt;
- active candidate mapping;
- signed 2FA temporary-token response;
- successful password-login session creation;
- audit fields and bounded audit failure behavior;
- no-candidate neutral denial without bcrypt;
- invalid-password neutral denial without session creation;
- repository-error fail-closed behavior; and
- parameterized repository queries and malformed-row rejection.

The full unit suite passed:

- test files: 141 passed and 1 skipped;
- tests: 1,338 passed and 7 skipped;
- failures: 0.

The skipped tests are the existing opt-in PostgreSQL search-provider integration cases.

Additional checks passed:

- TypeScript type-check;
- ESLint on every changed TypeScript file;
- Prettier check;
- `git diff --check`;
- no em dash in the versioned analysis or validation records;
- no `bootstrapDb` reference in `src/app/api/auth/login/route.ts`; and
- optimized Next.js production build.

The production build compiled, completed TypeScript, generated all static pages, and retained the
dynamic `/api/auth/login` route.

## 3. PostgreSQL 15 validation

Validation used local disposable PostgreSQL 15 only. No Azure database or production row was used.

### 3.1 Fresh database with runtime role created after migrations

Container `vaultspace-w1-2-login-route-v2` hosted a fresh database. The path matched CI ordering:

1. Apply all 44 Prisma migrations as the disposable administrator.
2. Run the guarded RLS setup with `ALLOW_RLS_TEST_DB_SETUP=true`.
3. Create or normalize `vaultspace_app` through that setup.
4. Apply and verify the exact login-function grant through the guarded setup.
5. Test through the ordinary runtime connection.

All migrations applied successfully, including
`20260812143000_w1_2_login_route_conversion`.

The three bootstrap integration files passed 15 of 15 tests. They proved:

- login function runtime execution succeeds;
- session and organization functions remain runtime-denied;
- the owner remains unreachable;
- owner privileges remain the accepted four-table SELECT set;
- the login projection is exact and deterministic;
- inactive user, membership, and organization states return no row;
- hostile SQL-shaped input returns no row;
- session and organization foundations retain owner-only execution; and
- no existing foundation contract regressed.

### 3.2 Production-style database with runtime role present before migrations

Production-style fresh databases in the same disposable PostgreSQL cluster were created after
`vaultspace_app` existed. This made the new migration itself apply the production grant. The final
reviewed migration, including its SQL-language and stored-source checksum guards, was reapplied to
a new database after that review change.

All 44 migrations applied successfully. Immediate post-migration catalog evidence was:

| Check                        | Result                                              |
| ---------------------------- | --------------------------------------------------- |
| Login EXECUTE grantees       | `vaultspace_app`, `vaultspace_bootstrap_owner` only |
| Session runtime EXECUTE      | false                                               |
| Organization runtime EXECUTE | false                                               |
| Runtime reaches owner        | false                                               |
| Conversion migration         | finished, not rolled back                           |

This proves both supported creation orders without creating a runtime password in the migration.

### 3.3 Full RLS regression

The full `tests/integration/rls.test.ts` suite passed 39 of 39 tests with the required guarded
disposable-database flag. The suite includes:

- NOBYPASSRLS runtime posture;
- forced-RLS tenant isolation;
- provider inbox and provider-correlation isolation;
- protected-function overload and role-reachability negatives;
- password-reset delivery and concurrency contracts;
- immutable audit behavior;
- permission-engine tenant isolation; and
- service-layer RLS behavior.

The first invocation omitted `ALLOW_RLS_TEST_DB_SETUP=true`; one existing populated-migration test
rejected that invocation before performing its guarded setup. It was rerun with the required flag
and passed. No code change or waiver was used.

The remaining six integration files passed 30 of 30 tests:

- password-reset provider-final evidence;
- W1-1 authorization room scope;
- W1-1 link admission concurrency;
- login bootstrap candidate;
- session bootstrap resolve; and
- organization bootstrap resolve.

## 4. Migration and ACL review

The new migration is additive and bounded by a 10-second lock timeout and 120-second statement
timeout.

Before granting execution it verifies:

- exact owner attributes;
- no owner membership in either direction;
- one exact function and no overload;
- exact identity arguments;
- exact owner;
- SQL language;
- SECURITY DEFINER;
- stable volatility;
- parallel restricted mode;
- `search_path=pg_catalog`;
- exact stored-source MD5 as a migration-time catalog guard;
- exact contract marker; and
- owner-only preexisting execution ACL.

When `vaultspace_app` already exists, it also verifies:

- LOGIN;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION; and
- no membership reachability to the function owner.

After the exact grant it verifies:

- login execution is available to the runtime;
- session execution is unavailable to the runtime;
- organization execution is unavailable to the runtime; and
- no third EXECUTE grantee exists.

The accepted login function source remains unchanged. The real-role integration test continues to
bind its exact SHA-256 value:

`72b12f72ab12ca301cce0b168463dd294df01fa2c0ca1e07b8668643b267db38`

## 5. Application review

The login route performs the same sequence with one bounded lookup substitution:

1. Validate request body.
2. Derive request context.
3. Enforce email and IP rate limits.
4. Resolve the narrow candidate.
5. Verify password with bcrypt.
6. Return the established 2FA-required response when enabled.
7. Otherwise create the org-bound session and stamp `lastLoginAt` in the existing RLS transaction.
8. Set the established session cookie.
9. Capture the bounded login audit event.
10. Return the established user and organization projection.

The generic error log was tightened to emit only component, categorical outcome, and error class
name. It does not emit email, password, password hash, candidate row, query, token, or database
error detail.

The function contract intentionally collapses unknown user, inactive user, inactive membership,
and inactive organization into the same no-row result. The route maps that result to the existing
invalid-credential HTTP 401 response. It does not disclose whether an account or organization
exists.

## 6. Strawman, Steelman, and Pre-Mortem outcome

### Strawman

The draft introduces a database function dependency into the login path while the admin URL is
still available. A failure in the grant, function, repository, or runtime role can deny all logins.

### Steelman

The candidate lookup is the smallest production bootstrap family and now uses one exact function,
one minimal projection, one exact grant, and no admin fallback. Password verification and session
writes stay on their established paths, keeping the first routed cut independently reviewable.

### Pre-Mortem

The most likely failure is an EXECUTE or RLS mismatch that appears only under the runtime role. Both
supported migration orders and the actual runtime client were exercised against PostgreSQL 15.
Wrong grant, broader grant, owner reachability, neutral-denial drift, session-family exposure, and
organization-family exposure all have blocking tests.

## 7. Disposable infrastructure posture

Two local container objects are retained for explicit cleanup authorization:

| Container                        | State                | Reason retained                                                    |
| -------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `vaultspace-w1-2-login-route-v1` | Created, not running | Initial loopback port was already allocated                        |
| `vaultspace-w1-2-login-route-v2` | Exited 0             | Successful PostgreSQL 15 validation and three disposable databases |

Neither container is running. No container was deleted. No other local container was changed.

## 8. Unit 3 evidence merge operational note

PR #132 merged as `072e7f66843f7ee5353a3906ac3a4ac35c62d707`. Exact-main CI run
`31607013785` succeeded. Because the deploy workflow remained active as authorized, normal
workflow-run deployment `31607652943` completed successfully for that pure evidence successor.

Quick uncached health is green:

- release: `072e7f66843f7ee5353a3906ac3a4ac35c62d707`;
- web revision: `ca-vaultspace-web--0000288`;
- status: healthy;
- mode: Azure;
- degraded capabilities: none; and
- cache control: `no-store, max-age=0`.

Azure control-plane verification in Munger subscription 1 found:

- exactly one active web revision;
- Healthy and Provisioned web state;
- one replica;
- 100 percent traffic to `ca-vaultspace-web--0000288`;
- web runnable digest
  `sha256:6d9e4a9891550a077828eae74453ec546873ef4d48cef7cf7c89f91a45e0affe`;
- active Healthy worker revision `ca-vaultspace-worker--0000271`; and
- worker plus all three scheduled jobs on
  `sha256:d3ccf81df6542b9bc956c3daf5985922b38dcb86c7564428805ec0352b55cd15`.

This pure evidence deployment does not route the draft login conversion and does not reopen Unit 3.

## 9. Gate status

**W1-2 login route conversion: IMPLEMENTED IN BRANCH, VALIDATION GREEN, NOT MERGED, NOT DEPLOYED.**

**W1-2 overall: OPEN.**

The next gate is human and CI review of the draft PR. Merge and controlled deployment require a
separate Advisor GO. The admin URL remains present. Session and organization functions remain
runtime-inaccessible. No later routed family is implied.

## References

- PR #132
- Main CI run `31607013785`
- Deploy run `31607652943`
- `docs/W1_2_LOGIN_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `prisma/migrations/20260812143000_w1_2_login_route_conversion/migration.sql`
- `scripts/setup-rls-test-db.ts`
- `src/lib/auth/bootstrapRepository.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/login/route.test.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
