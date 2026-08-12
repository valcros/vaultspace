# W1-2 Session Mutation Foundation Deployment Evidence

- **Date:** 2026-08-12
- **Advisor authorization:** ADV-2026-08-12-01
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Inert session-mutation foundation
- **Source PR:** #139
- **Reviewed source head:** `8d4d9aa2582f2ca8ca7b983cd603ebf068ef2cee`
- **Merge commit and deployed release:** `e0dbf5241caf98873935050c5e5840dae19660f0`
- **Exact-head PR CI:** `31641003776`, success
- **Exact-main CI:** `31645394617`, success
- **Deployment:** `31646044319`, one dispatch, success
- **Live web revision:** `ca-vaultspace-web--0000295`
- **Result:** Deployment, catalog posture, and bounded CloudVault regression smoke green
- **W1-2 Unit 7 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit deployed only the previously reviewed inert session-mutation foundation. It added five
owner-only `SECURITY DEFINER` functions:

- `bootstrap_session_create_v1`;
- `bootstrap_session_refresh_v1`;
- `bootstrap_session_invalidate_v1`;
- `bootstrap_session_revoke_user_org_v1`; and
- `bootstrap_session_revoke_user_global_v1`.

The migration retained all five functions as executable only by `vaultspace_bootstrap_owner`. It
added exact column-scoped session `INSERT` and `UPDATE` privileges to that owner, retained table
level `SELECT` on the four reviewed bootstrap tables, and did not grant table-level write or
`DELETE`.

This unit did not:

- grant `vaultspace_app` execution on any mutation function;
- import or route `sessionMutationRepository` from a live path;
- convert session creation, activity refresh, logout, or bulk revocation;
- execute any of the five new functions during acceptance;
- change Redis keys, TTLs, cache admission, or eviction;
- remove or change `DATABASE_URL_ADMIN`;
- change the web entrypoint, migration runner, workflow implementation, or networking;
- access Brightside;
- access CloudVault rooms, documents, links, or customer data;
- run production `deep=true` health;
- rotate the separately noted demo credential; or
- change W1-3 or P0-4.

## 2. Human review and exact-head validation

Human review covered the complete six-file PR #139 diff and confirmed:

- all five functions use exact object qualification, `SECURITY DEFINER`, and
  `search_path=pg_catalog`;
- the function contracts return only session IDs and necessary timestamps, not raw session
  tokens, IP addresses, user agents, password material, 2FA material, or customer data;
- the two caller-scoped bulk revoke functions remain owner-only;
- runtime and `PUBLIC` execution are explicitly revoked on every new function;
- owner role membership is temporary only for ownership transfer and is revoked before commit;
- the migration asserts zero residual owner memberships and no runtime reachability;
- only reviewed session columns receive `INSERT` or `UPDATE`;
- no session table-level `INSERT`, table-level `UPDATE`, or `DELETE` is granted;
- the live runtime matrix remains the three accepted resolve functions;
- repository-wide search finds no live import of `sessionMutationRepository`; and
- no route, session helper, cache, entrypoint, workflow, admin URL, W1-3, or P0-4 file changed.

The reviewed source head was `8d4d9aa2582f2ca8ca7b983cd603ebf068ef2cee`. Exact-head PR CI run
`31641003776` completed successfully, including lint, formatting, type checking, unit tests, RLS
integration, provider integration, E2E, production build, standalone and Azure deployment-mode
tests, security scan, and Docker builds.

## 3. Authorized local cleanup

The stopped disposable PostgreSQL container
`vaultspace-w1-2-session-mutation-v1` resolved uniquely and was removed exactly as authorized.
No other container, image, volume, file, Azure resource, or production record was deleted.

## 4. Controlled merge and exact-main CI

Before merge:

- workflow `251547585` was active;
- all recent real deployments were terminal;
- the historical ghost run `31428108038` remained unchanged and risk-accepted;
- the workflow was disabled and verified as `disabled_manually`; and
- production remained healthy at
  `39f8b5217af129775d40d87428575346157fdeeb / ca-vaultspace-web--0000294`.

PR #139 was marked ready and squash-merged with an exact-head guard. The resulting `main` SHA was
`e0dbf5241caf98873935050c5e5840dae19660f0`.

Exact-main CI run `31645394617` completed successfully on that SHA. The web and worker immutable
images published successfully, and all E2E, RLS, build, security, provider, unit, type, formatting,
and deployment-mode gates were green. No deployment started while workflow `251547585` was
disabled.

After exact-main CI:

- `main` still equaled the approved merge commit;
- no real deployment was queued or active;
- workflow `251547585` was re-enabled and verified `active`;
- enablement did not start a deployment; and
- exactly one manual dispatch was issued for the exact main SHA.

## 5. Single deployment and live identity

Deploy run `31646044319` completed successfully for
`e0dbf5241caf98873935050c5e5840dae19660f0`. No second dispatch was issued and recovery did not
run.

The pipeline passed safe rollback-source capture, immutable image resolution, password-reset
delivery compatibility, migration application, worker convergence, all three job updates, web
cutover, quick health, strict traffic convergence, and final worker readiness. The expected brief
dual-active transition converged on attempt 2 to one active web revision at 100 percent traffic.

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0` before and after
CloudVault smoke:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `e0dbf5241caf98873935050c5e5840dae19660f0` |
| Revision              | `ca-vaultspace-web--0000295`               |
| Degraded capabilities | none                                       |
| Reset write mode      | hmac                                       |
| Recovery configured   | true                                       |

## 6. Workload coherence and rollback posture

Independent read-only Azure verification used explicit Munger subscription ID
`041a67eb-fec8-41a4-9d70-c35863268cd6` on every command. No Medau query was made.

The web workload is exactly one active revision at 100 percent traffic:

- revision: `ca-vaultspace-web--0000295`;
- health: Healthy;
- provisioning: Provisioned;
- running: Running;
- replicas: 1; and
- digest: `sha256:e4ced84cde27f2e6787483162b26c5a77ed52072c3c2a940e1e99f49f77f1b10`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:f5c628e6425c79eb2889ca42244f93dbb7ec5da465cc10090f4b8e8d2c3aac90`

| Workload                         | Result                             |
| -------------------------------- | ---------------------------------- |
| `ca-vaultspace-worker--0000278`  | Healthy, Provisioned, ScaledToZero |
| `ca-vaultspace-delayed-waker`    | Succeeded, deployed worker digest  |
| `ca-vaultspace-invite-lifecycle` | Succeeded, deployed worker digest  |
| `ca-vaultspace-pwreset-recon`    | Succeeded, deployed worker digest  |

The immediate prior rollback artifacts remain retained:

- web `ca-vaultspace-web--0000294`, inactive, Healthy, Provisioned, digest
  `sha256:cac504ef68412d630a9a72a686227d902e6409195ef59d161c69867facc4b08a`; and
- worker `ca-vaultspace-worker--0000277`, inactive, Healthy, Provisioned, digest
  `sha256:87340e87d3f08aa17885d3b1c419331517ea17069beac296688c58033aaf5223`.

No revision or image was deleted. The deploy workflow remains active.

## 7. Production catalog acceptance

Catalog verification used a process-local connection obtained directly from the existing Munger
Key Vault. The secret value was not printed, persisted, written to a file, or placed literally in
shell history. Queries were limited to catalog, role, privilege, function, migration, and the
separately authorized synthetic CloudVault fixture records.

Migration `20260812210000_w1_2_session_mutation_foundation` is finished and has not been rolled
back.

### 7.1 Owner and table privilege posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- without direct or transitive memberships;
- unreachable by `vaultspace_app`; and
- without `CREATE` on schema `public`.

Its table-level privileges remain exactly `SELECT` on:

- `organizations`;
- `sessions`;
- `user_organizations`; and
- `users`.

Its session write posture is column-scoped only:

- `INSERT` on `id`, `createdAt`, `updatedAt`, `userId`, `organizationId`, `token`, `expiresAt`,
  `lastActiveAt`, `ipAddress`, `userAgent`, and `isActive`; and
- `UPDATE` on `updatedAt`, `expiresAt`, `lastActiveAt`, and `isActive`.

Table-level `INSERT`, table-level `UPDATE`, and `DELETE` are all false.

### 7.2 Exact eight-function ACL matrix

| Function                                                            | App EXECUTE | PUBLIC EXECUTE |
| ------------------------------------------------------------------- | ----------- | -------------- |
| `bootstrap_login_candidate_v1(text)`                                | yes         | no             |
| `bootstrap_session_resolve_v1(text)`                                | yes         | no             |
| `bootstrap_organization_resolve_v1(text,text)`                      | yes         | no             |
| `bootstrap_session_create_v1(text,text,text,timestamptz,text,text)` | no          | no             |
| `bootstrap_session_refresh_v1(text)`                                | no          | no             |
| `bootstrap_session_invalidate_v1(text)`                             | no          | no             |
| `bootstrap_session_revoke_user_org_v1(text,text)`                   | no          | no             |
| `bootstrap_session_revoke_user_global_v1(text,text)`                | no          | no             |

Every new function ACL contains only `vaultspace_bootstrap_owner` with `EXECUTE`.

### 7.3 Function contract and checksum posture

All five new functions are owned by `vaultspace_bootstrap_owner`, use `SECURITY DEFINER`, are
volatile and parallel-unsafe, and have exact `search_path=pg_catalog` configuration.

| Function                                  | Contract marker                                          | Stored source MD5                  |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `bootstrap_session_create_v1`             | `vaultspace-contract:w1-2-session-create-v1`             | `c5eaf4c683685818b4128f178acd74a8` |
| `bootstrap_session_refresh_v1`            | `vaultspace-contract:w1-2-session-refresh-v1`            | `f747a5fedcee62492164961a77355a59` |
| `bootstrap_session_invalidate_v1`         | `vaultspace-contract:w1-2-session-invalidate-v1`         | `c4b67ed0192a62783a9137a66392cb27` |
| `bootstrap_session_revoke_user_org_v1`    | `vaultspace-contract:w1-2-session-revoke-user-org-v1`    | `f14b7c036c3c23bc48c87088813db04a` |
| `bootstrap_session_revoke_user_global_v1` | `vaultspace-contract:w1-2-session-revoke-user-global-v1` | `0cf271c362588da118143a391936f6c6` |

All values match the reviewed migration.

## 8. CloudVault bounded regression acceptance

The versioned runner
`scripts/cloudvault-w1-2-session-mutation-foundation-acceptance-v1.cjs` performed only the
authorized regression smoke against the retained active synthetic organization named exactly
`CloudVault` with slug `cloudvault-w1-2-verify`.

It created one dedicated synthetic VIEWER with a generated process-memory password. The password
was not printed or persisted.

| Authorized check                                           | Result |
| ---------------------------------------------------------- | ------ |
| Login returns 200 with exact CloudVault identity           | PASS   |
| `/api/auth/me` returns 200 for the exact synthetic session | PASS   |
| Logout returns 200                                         | PASS   |
| The old session returns the established neutral 401        | PASS   |

Result: **4/4 PASS**.

The first runner attempt stopped before fixture creation because its expected query object used
camelCase labels while PostgreSQL returned the selected snake_case aliases. The returned catalog
values already showed the exact three approved runtime functions. Cleanup confirmed zero active
synthetic records.

The second attempt passed health, the complete catalog gate, and exact CloudVault login, then
stopped because the runner incorrectly expected `/api/auth/me` to repeat organization fields. The
accepted endpoint contract returns the authenticated user. Cleanup soft-disabled that synthetic
user, membership, and session.

The runner was corrected to assert the authenticated user from `/api/auth/me` and independently
bind the synthetic session token to the exact CloudVault organization in the database. The third
attempt passed every gate. These were evidence-runner assertion corrections, not product,
migration, ACL, or deployment failures. No deployment was repeated.

Final cleanup confirmed zero active synthetic users, memberships, or sessions from the operation.
The retained CloudVault organization remains active and unchanged. No room, document, link,
preview, download, export, content, or Brightside path was accessed.

## 9. Standing status

W1-2 Units 1 through 6 remain acceptance-closed. Unit 7 inert session-mutation foundation is live,
catalog-green, and CloudVault regression-green, pending written Advisor close-out. W1-2 overall
remains open.

The live runtime grant matrix remains login candidate, session resolve, and organization resolve
only. All five mutation functions remain owner-only and unrouted. Session mutation behavior and
Redis behavior are unchanged. The admin URL remains present. W1-3 is not started. The security
freeze remains active. P0-4 remains accepted and unchanged.

## References

- Advisor reply `ADV-2026-08-12-01`
- Source PR #139
- Exact-head CI run `31641003776`
- Exact-main CI run `31645394617`
- Deploy run `31646044319`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_VALIDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
- `scripts/cloudvault-w1-2-session-mutation-foundation-acceptance-v1.cjs`
