# W1-2 Login Bootstrap Foundation Validation

- **Date:** 2026-08-11
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive login-candidate foundation
- **Status:** Prepared for draft review, not merged, not deployed, not used by a route
- **Analysis record:** `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- **Analysis-first commit:** `f88996d`
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Outcome

The additive login bootstrap foundation is implemented and locally validated on PostgreSQL 15.
The implementation introduces:

1. A `vaultspace_bootstrap_owner` role with `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`,
   `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION`.
2. Exact `SELECT` privileges on `users`, `user_organizations`, and `organizations` only.
3. Three restrictive, owner-specific, active-row `SELECT` policies on those FORCE RLS tables.
4. One static SQL, `SECURITY DEFINER` login-candidate function with a fixed minimal projection.
5. One typed repository that calls the exact function signature through a parameterized Prisma
   query.
6. Unit and real PostgreSQL catalog, privilege, RLS, hostile-input, and projection tests.

The implementation deliberately does not:

- import or call the repository from the login route;
- grant function execution to `vaultspace_app`;
- remove or change `bootstrapDb`;
- remove `DATABASE_URL_ADMIN`;
- change the web entrypoint;
- change a deployment workflow;
- create or update an Azure resource;
- remove an existing bootstrap policy;
- implement W1-3 enforcement;
- change malware scanning or P0-4 behavior;
- query Brightside data.

## 2. Analysis-first chronology

The mandatory Strawman, Steelman, Pre-Mortem, rollback, and go or no-go record was committed in
`f88996d` before the first migration, repository, or test file was created.

The implementation boundary remained the same after testing:

- database objects are additive;
- the function is inert for the runtime role;
- no public request path depends on the new objects;
- the current admin-backed bootstrap path remains available;
- route conversion and runtime execution grant require a later implementation unit and review.

## 3. Validation-driven correction

### Initial finding

The first disposable PostgreSQL run exposed a policy-composition error. The initial owner-specific
policies were permissive. PostgreSQL OR-combined them with the existing permissive bootstrap
policies, so directly assuming the NOLOGIN owner as the migration administrator could still read
an inactive user.

The function query itself still required active user, membership, and organization rows, but the
direct owner-role defense-in-depth claim was not satisfied.

### Correction

All three owner-specific policies were changed to `AS RESTRICTIVE`. Catalog tests now require the
`RESTRICTIVE` posture, and a direct owner-role test proves that an inactive user is excluded.

The disposable PostgreSQL container and database were recreated from scratch after this change.
All migrations, RLS setup, catalog checks, and integration tests were rerun against the fresh
database. No applied or shared migration was edited.

### Azure administrator compatibility correction

A second disposable PostgreSQL 15 cluster emulated Azure's non-superuser administrator with
`CREATEROLE` and `CREATEDB`. It showed that a non-superuser administrator may create the exact
constrained owner but cannot execute even a no-op `ALTER ROLE ... NOSUPERUSER` command.

The migration was changed to create the owner with exact attributes when absent and fail closed if
a pre-existing role has any forbidden attribute. It no longer tries to normalize a pre-existing
role. The failed emulator migration rolled back transactionally before any owner, policy, or
function remained.

The corrected migration was then applied from scratch by the non-superuser administrator. This
proved role creation, temporary membership, function ownership transfer, membership revocation,
and final catalog posture without superuser authority.

The emulator also proved that ACL revocation must occur before function ownership transfer. A
constrained administrator cannot change function ACLs after transferring ownership and revoking
temporary membership. The migration now revokes `PUBLIC` and any pre-existing runtime execution
while the migration administrator still owns the function, then transfers ownership. The exact
final ACL assertion remains in place.

## 4. Database contract proved

### Owner role

- Cannot log in.
- Cannot inherit privileges.
- Is not superuser.
- Does not bypass RLS.
- Cannot create databases or roles.
- Cannot replicate.
- Is not reachable directly or transitively from `vaultspace_app`.
- Cannot be assumed by `vaultspace_app` with `SET ROLE`.

### Object privileges

- Has schema `USAGE`, not schema `CREATE`.
- Has table `SELECT` only on `users`, `user_organizations`, and `organizations`.
- Has no other direct table privilege.
- Owns the exact login-candidate function.
- Is the only role with function execution in the foundation posture.
- `PUBLIC` cannot execute the function.
- `vaultspace_app` cannot execute the function.

### Function posture

- Exact signature: `public.bootstrap_login_candidate_v1(text)`.
- SQL language.
- Stable and parallel restricted.
- `SECURITY DEFINER` enabled.
- Exact `search_path=pg_catalog` configuration.
- Fully qualified public table references.
- Static SQL with no dynamic execution.
- Exact contract comment: `vaultspace-contract:w1-2-login-candidate-v1`.
- Stored source SHA-256:
  `72b12f72ab12ca301cce0b168463dd294df01fa2c0ca1e07b8668643b267db38`.

### Behavior

- Returns one deterministic active login candidate for a normalized email.
- Chooses the earliest active membership by creation timestamp and ID.
- Returns neutral no-row results for unknown identity, inactive user, inactive membership, and
  inactive organization.
- Ignores a hostile caller search path.
- Treats SQL-shaped email input as data.
- Does not return TOTP secrets or backup-code hashes.
- Fails closed in the typed repository on an unexpected duplicate, invalid role, or invalid row.
- Removes the temporary test-only runtime grant before the integration test commits.

## 5. Verification executed

### Migration and RLS setup

- PostgreSQL image: `postgres:15-alpine`.
- Fresh database migration: 41 of 41 migrations applied.
- RLS test role setup: passed.
- Existing RLS repair verification: passed.
- New focused integration: 7 of 7 passed.
- Non-superuser Azure administrator emulation: passed after the fail-closed migration correction.

### CI-shaped RLS matrix

Command posture matched the repository CI job, including
`ALLOW_RLS_TEST_DB_SETUP=true`.

- Test files: 5 passed.
- Tests: 61 passed.
- Included existing RLS isolation, password-reset provider evidence, W1-1 room authorization,
  W1-1 link concurrency, and the new W1-2 bootstrap foundation.

An earlier local invocation omitted `ALLOW_RLS_TEST_DB_SETUP=true`. It completed 60 assertions and
then stopped at the guarded populated-migration test. The exact CI-shaped rerun passed all 61 tests.
No waiver was used.

### Application checks

- `npm run type-check`: passed.
- `npm run lint`: passed with zero errors and one pre-existing hook dependency warning outside this
  diff.
- `npm test`: 141 files passed, 1 file intentionally skipped; 1,319 tests passed and 7 tests were
  intentionally skipped.
- Focused repository unit tests: 6 of 6 passed.
- Prettier check on changed JSON, TypeScript, and Markdown: passed.
- `git diff --check`: passed.

## 6. Production observation during preparation

Merging the already authorized W1-1 evidence PR produced main CI run `31544731337`, which passed.
The active automatic deploy workflow then started run `31545255539` for the docs-only merge SHA
`d07b79c9a74cb86fa012f38a5f778430bfb45a6a`.

That deploy stopped in `Capture staging before-state` before any mutation because the current
worker revision was momentarily reported as `Activating` with one replica, despite being healthy
and provisioned. No image verification, migration, worker update, web update, job update, or
recovery mutation ran.

A subsequent read-only check in the Munger subscription showed:

- quick health HTTP 200 with `Cache-Control: no-store`;
- release `1502b3997bed57b279a5acb8f6e7eea791b9090e`;
- web revision `ca-vaultspace-web--0000284`;
- one active healthy web revision with 100 percent traffic;
- worker revision `ca-vaultspace-worker--0000267` healthy, provisioned, and scaled to zero.

This W1-2 branch does not change the pipeline. The implementation must remain a draft and must not
merge until the failed pre-mutation deploy posture is reviewed. The failed deploy was not retried.

## 7. Rollback and deployment posture

Before merge, rollback is closing the draft or abandoning the branch changes.

If the additive migration is later applied:

- keep runtime and `PUBLIC` execution revoked;
- keep the current login route on its existing path;
- do not edit the applied migration;
- correct catalog posture only through a reviewed follow-up migration;
- retain the prior web revision even though this unit introduces no route behavior.

Because no route calls the function and the runtime role cannot execute it, an applied foundation
can remain inert while a correction is reviewed. No ad hoc role, policy, function, Azure, or Key
Vault changes are part of rollback.

## 8. Gate status

### Ready for draft review

- Additive role, policy, function, repository, and tests.
- Analysis-first evidence.
- PostgreSQL 15 migration proof.
- Exact catalog and source contract.
- Full local unit and RLS regression evidence.

### Still blocked

- Merge or deployment while deploy run `31545255539` remains an unexplained operational gate.
- Runtime `EXECUTE` grant.
- Login route conversion.
- CloudVault authentication matrix for a route conversion.
- Web entrypoint DDL removal.
- One-shot Azure migrator cutover.
- Web `DATABASE_URL_ADMIN` removal.
- W1-3 bootstrap-policy removal or production FORCE changes.

## 9. Standing status

W1-1 remains closed. W1-2 has begun with an additive foundation prepared in draft only. The public
web admin database privilege remains open. W1-3 production enforcement has not started. The
security freeze and silent-hardening posture remain active. P0-4 remains accepted and unchanged.

## 10. References

- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `prisma/migrations/20260811231000_w1_2_login_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/bootstrapRepository.test.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
- `.github/workflows/ci.yml`
- GitHub Actions run `31544731337`
- GitHub Actions run `31545255539`
- Microsoft Azure PostgreSQL access management:
  https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control
