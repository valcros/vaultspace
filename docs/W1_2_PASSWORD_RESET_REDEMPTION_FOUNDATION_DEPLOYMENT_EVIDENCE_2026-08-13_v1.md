# W1-2 Unit 10 Password Reset Redemption Foundation Deployment Evidence

- Date: 2026-08-13
- Advisor authorizations: `ADV-2026-08-13-06` through `ADV-2026-08-13-11`
- Unit: W1-2 Unit 10, inert password-reset redemption foundation
- Foundation PR: #145
- Credential and diagnostic recovery PR: #146
- Final collation recovery PR: #147
- Reviewed PR #147 head: `edb5a929d9c7b8eb778d5d2feccbcd91ab617322`
- Deployed release: `f8a67674f6c43521873f4c2c74ca9fe453b9e732`
- Live web revision: `ca-vaultspace-web--0000300`
- Live worker revision: `ca-vaultspace-worker--0000283`
- Result: Migration, inert function posture, exact nine-function runtime catalog, and CloudVault
  foundation regression green
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Outcome

W1-2 Unit 10 is deployed and technically acceptance-green, pending written Stakeholder Advisor
close-out.

The deployed unit creates two inert password-reset redemption functions:

1. `bootstrap_password_reset_candidate_v1(text)`; and
2. `bootstrap_password_reset_redeem_v1(text, text)`.

Both functions are owned by `vaultspace_bootstrap_owner`, deny PUBLIC, deny `vaultspace_app`, and
remain unrouted. The application runtime EXECUTE matrix remains exactly the nine functions
accepted at the end of Unit 9.

The successful recovery sequence completed with:

- an exact-head guarded squash merge of the final corrective PR;
- exact-main CI and immutable image publication while deployment was disabled;
- a failed-jobs-only rerun of the established external Google Fonts 404;
- no side-effect deployment when the workflow was re-enabled;
- explicit resolution of only the unresolved, zero-step Prisma migration record;
- exactly one manual staging dispatch;
- no recovery activation, rollback, or second dispatch;
- exact production catalog acceptance;
- CloudVault `5/5` foundation regression acceptance; and
- retention of the required Unit 9 rollback revisions.

W1-2 overall remains open. This evidence does not authorize route conversion, runtime EXECUTE on
either new function, password-reset issuance changes, removal of `DATABASE_URL_ADMIN`, W1-3
enforcement, P0-4 changes, or any additional deployment dispatch.

## 2. Authorized and deployed boundary

The foundation migration deploys a split capability contract:

- the candidate function accepts only the non-reversible stored token lookup and returns only
  `candidate_proven = true` or no row;
- the redeem function accepts only the stored token lookup and a precomputed password hash;
- PostgreSQL derives the subject, reset flow, account state, audit scope, and revoked session IDs
  from the locked reset row;
- the redeem function claims the reset flow once, supersedes related flows, updates the password,
  and revokes the subject's sessions within the database transaction; and
- the typed server-only result envelope supports later atomic audit insertion and targeted cache
  eviction during route conversion.

The foundation does not route `/api/auth/reset-password` through either function and grants no new
runtime privilege. The typed `PasswordResetCapabilityRepository` remains an unrouted foundation
adapter.

The following boundaries remain excluded:

- `vaultspace_app` EXECUTE on either password-reset function;
- PUBLIC EXECUTE on either password-reset function;
- anonymous reset issuance or administrator reset issuance conversion;
- provider delivery transition conversion;
- `/api/auth/reset-password` route conversion;
- administrator cancellation and broader account-lifecycle conversion;
- revocation of the temporary direct runtime reset-table privileges;
- registration, public-link, viewer-session, or access-request conversion;
- `DATABASE_URL_ADMIN` removal;
- W1-3 or P0-4 changes;
- rollback revision retirement; and
- a second deployment dispatch.

## 3. Premerge implementation and recovery verification

The initial foundation implementation in PR #145 passed exact-head CI and local PostgreSQL
real-role coverage. The first staging deploy did not reach DDL because the deploy workflow bound
`MIGRATION_DATABASE_URL` to the runtime application connection. The migration preflight rejected
that identity before any application or Container Apps mutation.

PR #146 corrected the staging workflow binding to use the migration-owner secret and added a
workflow contract regression test. It also moved the credential preflight ahead of the Prisma DDL
transaction so a wrong credential produces the categorical
`BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN` error without transaction-abort masking.

The second staging attempt authenticated correctly as the migration owner and passed the role and
catalog preflight. A rollback-only statement-level diagnostic then isolated the primary DDL error
as `BOOTSTRAP_RUNTIME_RESET_PRIVILEGES_CHANGED`. No privileges had changed. Both arrays contained
152 identical ACL keys, but implicit collation differences ordered mixed-case identifiers
differently.

PR #147 applied `COLLATE pg_catalog."C"` to both ACL-key aggregations. A rollback-only staging proof
using `psql -v ON_ERROR_STOP=1` then completed all migration statements, posture assertions, and
function checks before the terminal `ROLLBACK`.

PR #147 remained at exact reviewed head
`edb5a929d9c7b8eb778d5d2feccbcd91ab617322`. Exact-head CI run `31734919432` completed
successfully across all 11 required jobs.

The final human review rechecked:

- deterministic `pg_catalog."C"` collation on both exact ACL arrays;
- no weakening or removal of the fail-closed privilege comparison;
- no runtime EXECUTE grant on either new function;
- no live route import of the capability repository;
- owner-only ACLs and fixed `search_path=pg_catalog`;
- candidate output limited to a positive proof marker;
- redeem identity and scope derived from the locked reset row;
- advisory-lock and row-lock order preserved;
- the existing nine-function runtime matrix preserved;
- the temporary reset-table privilege residual left unchanged;
- no `DATABASE_URL_ADMIN` removal; and
- no W1-3 or unrelated application change.

## 4. Failed deployment safety record

Two staging attempts failed before the final recovery deployment:

| Run           | Release                                    | Primary cause                                      | Production impact |
| ------------- | ------------------------------------------ | -------------------------------------------------- | ----------------- |
| `31723999076` | `c81a4227e0b091cfd4cc8d046d48f820784c6b05` | migration URL bound to runtime application role    | none              |
| `31731399089` | `733c470298f3ea942753ba8864ceaf7ddfbaf065` | nondeterministic implicit collation in ACL sorting | none              |

For both attempts:

- PostgreSQL rolled back the migration transaction;
- the two password-reset functions were absent after rollback;
- `vaultspace_app` retained exactly the Unit 9 nine-function matrix;
- no web, worker, job, environment, or traffic mutation occurred; and
- staging remained healthy on Unit 9 release
  `404c9f949bc4d24973ecf1290f99ff640c422dd3`.

Each failed Prisma ledger row had `applied_steps_count = 0`. The first was already marked rolled
back during the earlier recovery. The second remained unresolved until the final authorized
sequence.

No manual DDL, untracked catalog change, or production data repair was performed.

## 5. Controlled merge and exact-main CI

Before the final merge:

- deployment workflow `251547585` was verified `disabled_manually`;
- no active real staging deployment existed;
- PR #147 was open, draft, mergeable, and exact-head CI green;
- the PR head matched `edb5a929d9c7b8eb778d5d2feccbcd91ab617322`; and
- the two unrelated user worktree files were present but untouched and unstaged for this unit.

PR #147 was marked ready and squash-merged with the exact-head guard. The resulting `main` release
was `f8a67674f6c43521873f4c2c74ca9fe453b9e732`.

Exact-main CI run `31737789562` initially failed only in the password-reset browser E2E build when
Google Fonts returned HTTP 404 for Bricolage Grotesque resources. The migration chain completed,
the separate Build job passed, and Build & Push Images passed. Under the established external-font
flake policy, only the failed jobs were rerun. No code, font, workflow, or dependency change was
made. Attempt 2 passed the E2E job in full, including the password-reset first-dashboard browser
test.

The exact-main run then had all required jobs green. The exact-SHA multi-platform ACR image indexes
were present before deployment:

| Artifact | CI image index digest                                                     |
| -------- | ------------------------------------------------------------------------- |
| Web      | `sha256:5d7bd3e42370701443e7f366ba88c0d74db093565045d9697195baff97d73b62` |
| Worker   | `sha256:87ad4c90ccbb004caae75f1285b7603a9f6e8b5f2584b40cbc8d1eb38d03d038` |

Deployment remained disabled throughout the merge, exact-main CI, rerun, and image publication.
No deployment run was created for the Unit 10 release while disabled.

## 6. Prisma resolution and single deployment

After exact-main CI:

- workflow `251547585` was re-enabled and verified `active`;
- no side-effect workflow-run deployment appeared;
- the `main` tip still matched the reviewed release SHA; and
- no active real deployment existed.

The migration ledger was inspected before mutation. It contained two failed zero-step records:

1. the first record was already marked rolled back; and
2. the second record had no `finished_at` or `rolled_back_at` value.

The approved command marked only the second unresolved record rolled back:

`npx prisma migrate resolve --rolled-back "20260813150000_w1_2_password_reset_redemption_foundation"`

The post-resolution ledger showed both failed attempts rolled back with zero applied steps.
Exactly one manual staging dispatch was then issued for the unchanged `main` SHA.

Manual deployment run `31739314727` completed successfully in 7 minutes 24 seconds for
`f8a67674f6c43521873f4c2c74ca9fe453b9e732`. No second dispatch was issued. The built-in recovery
step was skipped because no deployment failure occurred.

The pipeline passed:

- staging rollback-source capture;
- exact image existence checks;
- password-reset delivery contract verification;
- migration application under `MIGRATION_DATABASE_URL`;
- worker update and readiness;
- password-reset cutover compatibility validation;
- password-reset reconciler update and preflight;
- web update;
- delayed-waker and invitation-lifecycle job updates;
- job-template and environment-shape validation;
- health and Azure deployment-mode validation;
- exact web revision, image, and traffic convergence; and
- final worker readiness.

The successful ledger row is complete:

| Migration                                                  | Finished | Rolled back | Applied steps |
| ---------------------------------------------------------- | -------- | ----------- | ------------- |
| `20260813150000_w1_2_password_reset_redemption_foundation` | yes      | no          | 1             |

## 7. Live identity, workload coherence, and rollback posture

Quick health returned HTTP 200:

| Field                      | Result                                     |
| -------------------------- | ------------------------------------------ |
| Status                     | healthy                                    |
| Mode                       | azure                                      |
| Release                    | `f8a67674f6c43521873f4c2c74ca9fe453b9e732` |
| Revision                   | `ca-vaultspace-web--0000300`               |
| Degraded capabilities      | none                                       |
| Password-reset reader      | version 1                                  |
| Password-reset writer mode | hmac                                       |
| Recovery delivery contract | version 1                                  |

Independent Azure verification used the explicit VaultSpace staging subscription on every query.
The web workload has one active revision at 100 percent traffic:

- revision: `ca-vaultspace-web--0000300`;
- health: Healthy;
- provisioning: Provisioned;
- running state: Running; and
- runtime image digest:
  `sha256:d11d274aa75aebdd129cb5a0d686133c7ab6b8e53925168b601f921051c9e633`.

The worker and all three jobs use one coherent worker digest:

`sha256:d0390f991dd47787aa2b17019ec62bb120bf1d382d426b40cd2e2f7a4bf3d63a`

| Workload                        | Result                             |
| ------------------------------- | ---------------------------------- |
| `ca-vaultspace-worker--0000283` | Healthy, Provisioned, ScaledToZero |
| delayed-waker job               | Succeeded, deployed worker digest  |
| invitation-lifecycle job        | Succeeded, deployed worker digest  |
| password-reset reconciler job   | Succeeded, deployed worker digest  |

The required Unit 9 rollback revisions remain retained, inactive, Healthy, and Provisioned:

| Workload | Revision                        | Runtime digest                                                            |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| Web      | `ca-vaultspace-web--0000299`    | `sha256:4819492adcd06ce94d7428e37d5178f0ff25df6b59e2647a81c648e19becdf53` |
| Worker   | `ca-vaultspace-worker--0000282` | `sha256:e2fc717b30b0766af873d0ec182c41b5eff537486efacf5f4305d74dbc741835` |

No revision, image, Azure resource, or rollback artifact was deleted. The deploy workflow remains
active.

## 8. Production catalog acceptance

Catalog verification used a process-local connection obtained from the existing VaultSpace Key
Vault. The secret value was not printed, persisted, written to a file, copied into evidence, or
placed literally in shell history.

### 8.1 Exact nine-function runtime matrix

`vaultspace_app` has EXECUTE on exactly these nine `bootstrap_*` functions:

| Function                                                                              | Runtime EXECUTE |
| ------------------------------------------------------------------------------------- | --------------- |
| `bootstrap_login_candidate_v1(text)`                                                  | yes             |
| `bootstrap_session_resolve_v1(text)`                                                  | yes             |
| `bootstrap_organization_resolve_v1(text, text)`                                       | yes             |
| `bootstrap_session_create_v1(text, text, text, timestamp with time zone, text, text)` | yes             |
| `bootstrap_session_refresh_v1(text)`                                                  | yes             |
| `bootstrap_session_invalidate_v1(text)`                                               | yes             |
| `bootstrap_session_revoke_self_others_v1(text)`                                       | yes             |
| `bootstrap_session_revoke_admin_user_org_v1(text, text)`                              | yes             |
| `bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)`                | yes             |

The runtime count is 9, the unexpected count is 0, and the missing count is 0.

The four owner-only functions remain unavailable to the runtime role:

| Function                                              | `vaultspace_app` | PUBLIC | Owner   |
| ----------------------------------------------------- | ---------------- | ------ | ------- |
| `bootstrap_session_revoke_user_org_v1(text, text)`    | denied           | denied | EXECUTE |
| `bootstrap_session_revoke_user_global_v1(text, text)` | denied           | denied | EXECUTE |
| `bootstrap_password_reset_candidate_v1(text)`         | denied           | denied | EXECUTE |
| `bootstrap_password_reset_redeem_v1(text, text)`      | denied           | denied | EXECUTE |

PUBLIC has no EXECUTE ACL on any of the 13 public `bootstrap_*` functions.

### 8.2 Password-reset function contracts

Both new functions are:

- owned by `vaultspace_bootstrap_owner`;
- `SECURITY DEFINER`;
- parallel unsafe;
- configured with `search_path=pg_catalog`;
- contract-marked; and
- source-checksummed against the reviewed migration.

| Function                                | Language | Volatility | Contract marker                                        | Source MD5                         |
| --------------------------------------- | -------- | ---------- | ------------------------------------------------------ | ---------------------------------- |
| `bootstrap_password_reset_candidate_v1` | SQL      | stable     | `vaultspace-contract:w1-2-password-reset-candidate-v1` | `fb2338b2271dcbe38ddb05f4b7a55e65` |
| `bootstrap_password_reset_redeem_v1`    | PL/pgSQL | volatile   | `vaultspace-contract:w1-2-password-reset-redeem-v1`    | `be86d46853493dc7dba68cfba0b68c4b` |

The candidate result is limited to `TABLE(candidate_proven boolean)`. The redeem result is the
reviewed typed server-only envelope and does not return a raw bearer token.

### 8.3 Owner, policy, and residual privilege posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- without direct role-membership edges; and
- unreachable by the runtime role under the reviewed role posture.

The owner has zero table-level `INSERT`, `UPDATE`, or `DELETE` privileges on `sessions`,
`password_reset_tokens`, and `password_reset_recoveries`. Reviewed column-scoped privileges and
owner-only policies remain the bounded data-access surface.

The migration compared 152 existing runtime ACL keys across `password_reset_tokens` and
`password_reset_recoveries` using explicit `pg_catalog."C"` ordering. The successful poststate
retains 152 keys. This preserves the explicitly accepted temporary direct privilege residual
without adding or removing a runtime reset-table privilege.

## 9. CloudVault foundation regression

The bounded regression targeted the exact live release, retained CloudVault organization
`cloudvault-w1-2-verify`, and a new dedicated synthetic user. It passed `5/5` checks:

| Check                                                                | Result |
| -------------------------------------------------------------------- | ------ |
| Health and exact release identity                                    | PASS   |
| Login creates an exact CloudVault-scoped live session                | PASS   |
| `/api/auth/me` resolves the exact synthetic identity and live scope  | PASS   |
| Public organization resolution returns only the approved projection  | PASS   |
| Logout invalidates the exact token and post-logout resolution is 401 | PASS   |

The first harness attempt expected an organization object in the `/api/auth/me` JSON response.
That field is not part of the established endpoint contract. The endpoint returned the correct
synthetic user, and the authoritative session row retained the exact CloudVault organization. The
first fixture was fully soft-disabled. The corrected bounded check used the established response
contract and verified organization scope from the authoritative session row. No application,
database, workflow, or deployment change was made for the harness correction.

After the green matrix, the final synthetic user, membership, and all sessions were soft-disabled.
The retained CloudVault organization was preserved. No customer record, room, document, link,
preview, download, export, or content matrix was accessed.

Brightside smoke was not required for this inert foundation and was not run.

## 10. Credential, environment, and worktree boundary

The public web workload still contains exactly one `DATABASE_URL_ADMIN` environment entry backed
by its existing secret reference. No literal connection value was present in the inspected
template. `DATABASE_URL_ADMIN` was not removed or altered.

The deploy workflow is active. No connection string, private key, token, cookie, password, PAT,
session ID, customer identifier, or customer content is present in this document.

The following unrelated user worktree files remained untouched and were not staged for this
evidence branch:

- `dataroom-feature-matrix-v6.md`; and
- `docs/SYSOP_DEVOPS_CONTROL_PLANE_DESIGN.md`.

## 11. Status and next gate

**W1-2 UNIT 10 PASSWORD RESET REDEMPTION FOUNDATION: DEPLOYED, INERT TWO-FUNCTION POSTURE GREEN,
EXACT NINE-FUNCTION RUNTIME CATALOG GREEN, CLOUDVAULT 5/5 GREEN, PENDING WRITTEN ADVISOR
CLOSE-OUT.**

Standing status:

- W1-1: CLOSED
- W1-2 Units 1 through 9: ACCEPTANCE-CLOSED
- W1-2 Unit 10: deployed and technically green, pending written Advisor close-out
- Live: `f8a67674f6c43521873f4c2c74ca9fe453b9e732 / ca-vaultspace-web--0000300`
- Runtime EXECUTE: exact Unit 9 nine-function matrix
- Password-reset candidate and redeem: OWNER-ONLY, UNROUTED
- Generic bulk revoke: OWNER-ONLY
- Admin URL: STILL PRESENT
- W1-2 overall: OPEN
- W1-3: NOT STARTED
- Deploy workflow: ACTIVE
- Freeze: ACTIVE
- P0-4: ACCEPTED and unchanged

The next route-conversion unit requires separate analysis and Advisor authorization. This document
does not authorize reset-route conversion, new runtime grants, reset-table privilege retirement,
admin URL removal, W1-3 enforcement, rollback retirement, or any additional staging dispatch.

## References

- Advisor architecture authorization `ADV-2026-08-13-06`
- Advisor foundation premerge authorization `ADV-2026-08-13-07`
- Advisor first-failure diagnostic authorization `ADV-2026-08-13-08`
- Advisor credential-recovery authorization `ADV-2026-08-13-09`
- Advisor DDL diagnostic authorization `ADV-2026-08-13-10`
- Advisor final recovery deployment authorization `ADV-2026-08-13-11`
- Foundation PR #145
- Credential and diagnostic recovery PR #146
- Final collation recovery PR #147
- PR #147 exact-head CI run `31734919432`
- Exact-main CI run `31737789562`, successful attempt 2
- Failed staging runs `31723999076` and `31731399089`
- Successful single staging deploy run `31739314727`
- `docs/W1_2_PASSWORD_RESET_CAPABILITY_CONTRACT_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_IMPLEMENTATION_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_MIGRATION_RECOVERY_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_DDL_COLLATION_RECOVERY_2026-08-13_v1.md`
- `prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql`
