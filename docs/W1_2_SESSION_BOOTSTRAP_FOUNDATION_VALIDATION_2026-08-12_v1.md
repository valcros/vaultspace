# W1-2 Session Bootstrap Foundation Validation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive session-resolve foundation
- **Status:** Prepared for draft review, not merged, not deployed, not used by a route
- **Analysis record:** `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- **Analysis-first commit:** `db0fd676987c199084c4e31d7e9ab23765f4024a`
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Outcome

The additive session bootstrap foundation is implemented and locally validated on PostgreSQL 15.
The unit introduces:

1. One exact `SELECT` privilege on `public.sessions` for the existing
   `vaultspace_bootstrap_owner`.
2. One static SQL, `SECURITY DEFINER` function for resolving a valid application session.
3. One typed, parameterized `BootstrapRepository.resolveSession` method backed by the ordinary
   runtime `db` client.
4. Unit and real PostgreSQL catalog, privilege, projection, hostile-input, expiry, and neutral
   denial tests.
5. CI coverage for the new integration suite while preserving the Unit 1 login-candidate suite.

The implementation deliberately does not:

- import or call the method from `validateSession`, server components, middleware, logout, or a
  route;
- grant function execution to `vaultspace_app`;
- grant function execution to `PUBLIC`;
- change `bootstrapDb`;
- remove `DATABASE_URL_ADMIN`;
- change the web entrypoint, deployment workflow, Azure, or Key Vault;
- add session mutation, activity refresh, invalidation, or Redis cache behavior;
- change W1-3 policy posture;
- change malware scanning or P0-4 behavior;
- access Brightside or customer data;
- deploy this branch.

## 2. Analysis-first chronology

The mandatory Strawman, Steelman, Pre-Mortem, rollback, and go or no-go record was committed in
`db0fd676987c199084c4e31d7e9ab23765f4024a` before the migration, repository, or test files were
created.

The implementation boundary remained unchanged after testing:

- one new table privilege;
- one new function;
- one unused repository method;
- runtime execution withheld;
- no route or deployment work.

## 3. Database contract proved

### 3.1 Owner posture

`vaultspace_bootstrap_owner` remains:

- `NOLOGIN`;
- `NOINHERIT`;
- `NOSUPERUSER`;
- `NOBYPASSRLS`;
- `NOCREATEDB`;
- `NOCREATEROLE`;
- `NOREPLICATION`;
- unreachable directly or transitively from `vaultspace_app`;
- unavailable to `vaultspace_app` through `SET ROLE`.

### 3.2 Object privileges

The owner has schema `USAGE`, not schema `CREATE`, and table `SELECT` only on:

- `organizations`;
- `sessions`;
- `user_organizations`;
- `users`.

The owner has no table write privilege, sequence privilege, unrelated table privilege, or schema
creation privilege.

### 3.3 Function posture

- Exact signature: `public.bootstrap_session_resolve_v1(text)`.
- Exact owner: `vaultspace_bootstrap_owner`.
- SQL language.
- Stable and parallel restricted.
- `SECURITY DEFINER` enabled.
- Exact `search_path=pg_catalog` configuration.
- Fully qualified table references.
- Static SQL with no dynamic execution.
- Exact contract comment: `vaultspace-contract:w1-2-session-resolve-v1`.
- Stored source SHA-256:
  `7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916`.
- Owner is the only role with execution in the foundation posture.
- `PUBLIC` cannot execute the function.
- `vaultspace_app` cannot execute the function.

### 3.4 Resolution behavior

The function returns one row only when all of these are true:

- the opaque token has the reviewed 43-character base64url shape;
- the stored token matches exactly;
- the session is active;
- the session has an organization binding;
- the idle expiry is in the future;
- the session remains within the seven-day absolute maximum;
- the user is active;
- the exact user and organization membership is active;
- the organization is active.

The projection includes only:

- session, user, and organization IDs;
- creation, idle-expiry, and last-active timestamps;
- user email and display name;
- active user state;
- organization name and slug;
- membership role and the two management flags.

It does not return the raw token, IP address, user agent, password hash, TOTP secret, backup-code
hashes, unrelated memberships, or customer data.

Unknown, malformed, inactive, unbound, idle-expired, absolute-max-expired, inactive-user,
inactive-membership, and inactive-organization cases all return the same neutral no-row result.
Caller search-path manipulation and SQL-shaped token input do not change resolution.

## 4. Validation-driven corrections

The first disposable migration attempts exposed three issues before any shared or production
application.

### 4.1 Array `COALESCE` qualification

The first attempt schema-qualified SQL `COALESCE` while checking the owner's existing privilege
array. PostgreSQL treats `COALESCE` as syntax rather than a callable `pg_catalog` function. The
migration failed inside its transaction and left no new privilege or function.

Correction:

- replace `pg_catalog.coalesce` with SQL `COALESCE` in both privilege-array checks;
- drop and recreate the named disposable database;
- rerun all migrations from the initial schema.

### 4.2 Reserved session-user identifier

The next fresh run showed that `session_user` is a PostgreSQL special identifier and cannot be used
as the intended table alias in the projection.

Correction:

- rename the alias to `resolved_user`;
- update and re-pin the stored function-source checksum;
- drop and recreate the disposable database;
- rerun all 42 migrations from scratch.

### 4.3 Boolean `COALESCE` in the role-reachability branch

The superuser migration path did not enter the runtime-role reachability branch because
`vaultspace_app` did not exist until disposable RLS setup. The separate Azure administrator
emulation did enter that branch and found one remaining schema-qualified boolean `COALESCE`.

Correction:

- replace the final `pg_catalog.coalesce` with SQL `COALESCE`;
- recreate the non-superuser emulator database;
- rerun all 42 migrations through the constrained administrator.

These corrections changed only the new, unapplied migration on this branch. No applied migration,
shared database, Azure resource, production configuration, or customer row was modified.

## 5. Verification executed

### 5.1 Fresh PostgreSQL 15 migration

- Image: `postgres:15-alpine`.
- Fresh database migrations: 42 of 42 applied.
- Existing Unit 1 owner and login function preserved.
- New session privilege and function posture applied transactionally.
- RLS setup completed through the guarded disposable-database script.

### 5.2 Azure administrator emulation

A second fresh database was owned and migrated by a non-superuser role with:

- `LOGIN`;
- `CREATEDB`;
- `CREATEROLE`;
- `NOSUPERUSER`;
- `NOBYPASSRLS`;
- `NOREPLICATION`.

All 42 migrations applied successfully. This proves the new migration can:

- validate the existing constrained owner;
- evaluate runtime role reachability;
- grant the exact table privilege;
- create the function;
- temporarily grant owner membership to the migrator;
- transfer function ownership;
- revoke temporary membership;
- finish with exact schema, table, function, and ACL posture;

without superuser authority.

### 5.3 Focused repository tests

- Test file: `src/lib/auth/bootstrapRepository.test.ts`.
- Tests: 14 of 14 passed.
- Covered exact parameterization, token and absolute-expiry constant alignment, neutral no-row,
  malformed-token rejection, duplicate rejection, role validation, timestamp validation, and
  incomplete-row rejection.

### 5.4 Focused PostgreSQL integration

- Test files: 2 passed.
- Tests: 11 passed.
- Included the existing login-candidate foundation and new session-resolve foundation.
- Temporary runtime execution was revoked before transaction completion.

### 5.5 CI-shaped RLS matrix

The repository `test:integration:rls` script now includes the session suite.

- Test files: 6 passed.
- Tests: 65 passed.
- Included existing RLS isolation, password-reset provider evidence and lock timeout, W1-1 room
  authorization, W1-1 link concurrency, W1-2 login foundation, and W1-2 session foundation.
- No waiver or rerun was needed.

### 5.6 Application checks

- `npm run type-check`: passed.
- `npm run lint`: passed with zero errors and one pre-existing hook dependency warning outside the
  diff.
- `npm test`: 141 files passed and 1 file intentionally skipped; 1,327 tests passed and 7 tests
  intentionally skipped.
- `npm run build`: passed, including TypeScript and static page generation.
- Changed-file Prettier formatting: passed.
- `git diff --check`: passed.
- Function source checksum recomputation: matched the pinned SHA-256.

## 6. CI and deploy-workflow restoration completed before implementation

Before this unit began:

- main CI run `31552098552` was rerun for failed jobs only on exact head
  `dfb4c1345b3fa78ed439fb693eeb890c4f6c97bd`;
- attempt 2 completed successfully, including RLS, E2E, build, and image publication;
- workflow `251547585` was re-enabled;
- the workflow state became `active`;
- five post-enable checks found no new deployment run;
- no dispatch occurred;
- the approved temporary quick-health response file was deleted.

The new session foundation branch has not been merged or deployed. The automatic deploy workflow
remains active for future approved main merges.

## 7. Disposable test cleanup

The local container `vaultspace-w1-2-session-foundation-v1` contained only synthetic PostgreSQL
databases, roles, and fixtures. It was stopped and removed after validation. No Azure or customer
database was used.

## 8. Rollback and deployment posture

Before merge, rollback is closing the draft or abandoning the branch.

If the additive migration is later approved and applied:

- keep runtime and `PUBLIC` execution revoked;
- keep all existing session and authentication paths unchanged;
- retain the prior web revision;
- do not edit or reverse the applied migration during immediate application rollback;
- correct any catalog issue through a new reviewed migration.

Because no route calls the function and runtime execution is withheld, the database objects can
remain inert while a correction is reviewed. No ad hoc production DDL is part of rollback.

## 9. Gate status

### Ready for draft review

- Analysis-first evidence.
- One additive session table privilege.
- One exact, inert session-resolve function.
- Typed unused repository method.
- PostgreSQL 15 superuser and Azure-like non-superuser migration proof.
- Exact catalog, ACL, source, projection, and neutral-denial tests.
- Full local application and RLS regression evidence.

### Still blocked

- Merge or production deployment without review and a controlled deploy decision.
- Runtime `EXECUTE` grant.
- Session helper or route conversion.
- Session mutation, cache, or logout conversion.
- CloudVault auth matrix for a replacement path.
- Web entrypoint DDL removal.
- One-shot Azure migrator cutover.
- Web `DATABASE_URL_ADMIN` removal.
- W1-3 bootstrap-policy removal or production FORCE changes.

## 10. Standing status

W1-1 remains closed. W1-2 Unit 1 remains acceptance-closed. This session-resolve foundation is
prepared locally for draft review only. The public web admin database privilege remains open. W1-3
production enforcement has not started. The security freeze and silent-hardening posture remain
active. P0-4 remains accepted and unchanged.

## 11. References

- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `prisma/migrations/20260812020000_w1_2_session_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/bootstrapRepository.test.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
- `tests/integration/bootstrap-session-resolve.test.ts`
- `package.json`
- GitHub Actions run `31552098552`, attempt 2
