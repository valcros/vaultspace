# W1-2 Session Mutation Foundation Validation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Implementation unit:** Additive, inert session-mutation foundation
- **Branch base:** `39f8b5217af129775d40d87428575346157fdeeb`
- **Status:** Local validation complete, draft review pending
- **Production change from this unit:** None

## 1. Unit 6 evidence follow-up

Before Unit 7 implementation:

- evidence PR #138 was verified at exact head
  `0377cc91a7bbe8156a9bd2f981c13b7cbc6192dd`;
- every PR check was green;
- PR #138 was marked ready and squash-merged as
  `39f8b5217af129775d40d87428575346157fdeeb`;
- exact-main CI run `31638577653` completed successfully, including E2E, RLS, builds, and image
  publication;
- the normal evidence-successor deployment run `31639294567` completed successfully; and
- final uncached quick health was healthy at release `39f8b5217af129775d40d87428575346157fdeeb`
  and web revision `ca-vaultspace-web--0000294`, with no degraded checks.

Unit 6 remains acceptance-closed. The Unit 7 branch starts from that exact successor SHA.

## 2. Implemented draft scope

The draft adds only new versioned files:

- analysis record;
- additive migration;
- typed session-mutation repository;
- repository unit tests;
- real PostgreSQL integration tests; and
- this validation record.

The migration adds five owner-only functions:

- `bootstrap_session_create_v1`;
- `bootstrap_session_refresh_v1`;
- `bootstrap_session_invalidate_v1`;
- `bootstrap_session_revoke_user_org_v1`; and
- `bootstrap_session_revoke_user_global_v1`.

No existing route, session helper, cache implementation, workflow, entrypoint, environment
contract, RLS policy, or production object was edited. Runtime and `PUBLIC` execution are withheld.

## 3. Security review findings

### 3.1 Function boundary

- Inputs are typed and length-bounded.
- Opaque tokens must match the established 43-character base64url shape.
- SQL is static and uses exact object qualification.
- Every function uses `SECURITY DEFINER` and `search_path=pg_catalog`.
- All five functions are `VOLATILE` and `PARALLEL UNSAFE`.
- Function owner is the existing constrained `vaultspace_bootstrap_owner`.
- The owner receives only exact session-column writes, not table-level write or delete.
- The functions return session IDs and required timestamps only.
- No result contains raw tokens, IP addresses, user agents, passwords, 2FA material, or customer
  data.

### 3.2 Authorization boundary

Session creation verifies active user, exact active membership, and active organization state.
Activity refresh verifies the complete active identity chain and both idle and absolute expiry.
Single-token invalidation deliberately remains possible after membership deactivation so logout can
terminate a stale session.

The two bulk revocation functions remain owner-only. Granting either function directly to the
runtime role would permit caller-selected user revocation and is not authorized by this foundation.
A later routed composition must internalize or otherwise prove the actor, target, organization, and
global-identity authorization contract before granting execution.

### 3.3 Cache boundary

The existing cache still uses token-derived keys. This inert unit does not change it. The later
routed unit should move cache eviction to versioned session-ID keys so mutation functions do not
need to return raw tokens. The authoritative live resolver remains a database call on every session
acceptance, so a stale Redis value cannot authorize a revoked session.

## 4. Disposable PostgreSQL validation

### 4.1 Fresh PostgreSQL 15 proof

A loopback-only disposable PostgreSQL 15 container was used. No Azure or customer database was
accessed.

Results:

- all 47 migrations applied from zero;
- the guarded RLS test-role setup succeeded;
- the exact existing three-function runtime matrix was preserved;
- all five new functions remained owner-only;
- the focused real-role session-mutation suite passed 8 of 8 tests; and
- pinned function source fingerprints and contract markers matched.

The first focused invocation exposed a PL/pgSQL identifier collision: `current_time` resolved as
PostgreSQL's time-valued expression in one comparison. The unapplied draft migration was corrected
to use the unambiguous `statement_time` variable. A second fresh database and then a third final
fresh database both applied all migrations successfully. The final real-role suite passed 8 of 8.
No production or shared database was involved.

### 4.2 Exact privilege result

`vaultspace_bootstrap_owner` retained table-level `SELECT` only on:

- `organizations`;
- `sessions`;
- `user_organizations`; and
- `users`.

It received column-scoped `INSERT` only for the session creation columns and column-scoped `UPDATE`
only for:

- `updatedAt`;
- `expiresAt`;
- `lastActiveAt`; and
- `isActive`.

Table-level `INSERT`, table-level `UPDATE`, and `DELETE` remained false. The runtime role could not
assume the owner and could not execute any of the five functions.

### 4.3 Azure-like constrained migrator proof

The new migration was also executed directly as a synthetic migrator with:

- LOGIN;
- CREATEDB;
- CREATEROLE;
- NOSUPERUSER;
- NOBYPASSRLS; and
- NOREPLICATION.

The first two migration attempts stopped in the read-only precondition because the cloned
synthetic database's table ownership and grant visibility did not yet match a database originally
owned by the migrator. No new function was created in either stopped transaction. The fixture was
corrected by making the synthetic migrator the exact owner of the four previously migrated tables
and reissuing the existing owner `SELECT` grants through that role.

The new migration then executed once to completion as the constrained migrator. Final catalog
output confirmed:

- migrator remained non-superuser and non-BYPASSRLS;
- bootstrap owner remained non-superuser and non-BYPASSRLS;
- all five functions were owned by `vaultspace_bootstrap_owner`;
- all five were `SECURITY DEFINER`;
- all five remained inaccessible to `vaultspace_app`; and
- residual bootstrap-owner memberships were zero.

## 5. Regression validation

| Check                                          | Result                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Repository unit suite                          | PASS, 146 files and 1,371 tests; 1 file and 7 tests intentionally skipped |
| New repository unit suite                      | PASS, 10 of 10                                                            |
| Complete RLS matrix plus new mutation contract | PASS, 8 files and 77 of 77 tests                                          |
| New PostgreSQL mutation contract               | PASS, 8 of 8                                                              |
| TypeScript                                     | PASS                                                                      |
| ESLint                                         | PASS, zero errors; one pre-existing unrelated hook warning                |
| Prettier on changed source and docs            | PASS                                                                      |
| Production build                               | PASS, 37 static pages                                                     |
| Fresh migration chain                          | PASS, 47 of 47                                                            |
| Constrained migrator                           | PASS                                                                      |

The full RLS matrix preserved:

- W1-1 room authorization and deny filtering;
- W1-1 link-admission concurrency;
- password-reset provider-final evidence;
- tenant RLS isolation;
- login candidate;
- session resolve;
- organization resolve; and
- exact runtime denial on the new mutation functions.

## 6. Scope and credential review

- No existing application or configuration file is part of the intended diff.
- No route imports `sessionMutationRepository`.
- No new `GRANT EXECUTE` targets the runtime role.
- `DATABASE_URL_ADMIN` is not added, removed, or changed.
- No Key Vault value, database URL, token, password, PAT, key, or customer identifier appears in
  the draft.
- Disposable database connection strings were passed only to local processes and were not written
  to source or evidence.
- W1-3 and P0-4 are unchanged.

## 7. Gate status

### Ready for draft review

- Analysis-first design record with Strawman, Steelman, and Pre-Mortem.
- Additive owner-only migration.
- Five narrow function contracts.
- Unrouted typed repository.
- Exact unit, catalog, privilege, projection, and behavior tests.
- Fresh PostgreSQL and constrained migrator proof.

### Still blocked

- Merge or production deployment without controlled Advisor orchestration.
- Runtime execution on any new function.
- Session creation, refresh, logout, or bulk-revoke route conversion.
- Cache-key conversion.
- Remaining auth-family conversion.
- Web entrypoint or migrator-job cutover.
- `DATABASE_URL_ADMIN` removal.
- W1-3 or P0-4 changes.

## 8. Standing status

W1-2 Units 1 through 6 are acceptance-closed. Unit 7 session-mutation foundation is locally green,
not merged, not deployed, and not routed. W1-2 overall remains open. The live runtime matrix remains
login candidate, session resolve, and organization resolve only. The admin URL remains present.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/lib/auth/sessionMutationRepository.test.ts`
- `tests/integration/bootstrap-session-mutation.test.ts`
- GitHub Actions main CI run `31638577653`
- GitHub Actions deploy run `31639294567`
