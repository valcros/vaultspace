# W1-2 Unit 9 Bounded Bulk Session Revocation Deployment Evidence

- Date: 2026-08-13
- Advisor authorizations: `ADV-2026-08-13-03`, `ADV-2026-08-13-04`
- Unit: W1-2 Unit 9
- Source PR: #143
- Reviewed PR head: `70be386eae6499a249745893ee5ee62bf7e36e6d`
- Deployed release: `404c9f949bc4d24973ecf1290f99ff640c422dd3`
- Live web revision: `ca-vaultspace-web--0000299`
- Live worker revision: `ca-vaultspace-worker--0000282`
- Result: Deployment, exact nine-function catalog, CloudVault bounded-revocation matrix, and bounded Brightside smoke green
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Outcome

W1-2 Unit 9 is deployed and technically acceptance-green, pending written Stakeholder Advisor
close-out.

The deployed unit converts authenticated bounded bulk session revocation through three
credential-bound database wrappers and changes Redis session cache keys to
`session:v2:<sessionId>`. PostgreSQL derives actor, organization, target bounds, and preserved
session identity from the validated bearer credential. The runtime application role cannot call
either generic bulk-revocation primitive.

The controlled merge and deployment completed with:

- an exact-head guarded squash merge;
- exact-main CI and immutable image publication while deployment was disabled;
- no side-effect deployment when the workflow was re-enabled;
- exactly one manual staging dispatch;
- no recovery activation, rollback, or second dispatch;
- exact production catalog acceptance;
- CloudVault `8/8` grouped acceptance;
- Brightside `5/5` bounded smoke acceptance; and
- retention of all required rollback revisions.

W1-2 overall remains open. This evidence does not authorize password-reset capability conversion,
account-lifecycle conversion, removal of `DATABASE_URL_ADMIN`, W1-3 enforcement, or P0-4 changes.

## 2. Authorized and deployed boundary

The unit deployed these three runtime wrappers:

1. `bootstrap_session_revoke_self_others_v1(text)` for signed-in password changes;
2. `bootstrap_session_revoke_admin_user_org_v1(text, text)` for tenant-admin membership role or
   active-state changes; and
3. `bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)` for tenant-admin email or
   two-factor changes to a single-organization identity.

The unit also deployed the versioned `session:v2:<sessionId>` Redis cache-key contract. SQL
revocation results contain session IDs, not raw bearer tokens, so application cache eviction is
targeted without propagating credentials.

The following boundaries remained excluded:

- direct runtime execution of `bootstrap_session_revoke_user_org_v1(text, text)`;
- direct runtime execution of `bootstrap_session_revoke_user_global_v1(text, text)`;
- unauthenticated password-reset redemption conversion;
- tenant-admin account-deletion conversion;
- shared-identity global deletion;
- registration, public-link, viewer-session, and access-request conversion;
- workflow or path-filter changes;
- migrator or web-entrypoint cutover;
- `DATABASE_URL_ADMIN` removal;
- W1-3 or P0-4 changes; and
- any second deployment dispatch.

## 3. Premerge verification and human review

PR #143 remained at exact reviewed head
`70be386eae6499a249745893ee5ee62bf7e36e6d`. Exact-head CI run `31667853221`
completed successfully across all required checks.

Reported exact-head validation included:

- 1,378 unit tests passed across 146 test files;
- RLS integration `85/85` passed across 8 test files;
- all 49 PostgreSQL migrations applied in order;
- Unit 9 PostgreSQL bounded-revocation matrix `16/16` passed;
- lint, formatting, type-check, security, provider inbox, Azure mode, standalone mode, build,
  container build, and E2E gates passed; and
- CodeRabbit status was successful.

The final human review rechecked:

- no deployment-workflow files changed;
- exactly three new application EXECUTE grants;
- generic bulk-revocation functions remained owner-only;
- the actor token, not caller-selected organization scope, drives authorization;
- the admin organization wrapper derives organization scope from the active actor session;
- the global wrapper counts all target memberships, including inactive memberships;
- shared identities cannot pass the single-organization global invariant;
- no new `bootstrapDb` fallback was added to converted production paths;
- cache eviction uses session IDs under the versioned cache contract;
- password-reset redemption remained on its established deferred path; and
- `DATABASE_URL_ADMIN` removal and W1-3 enforcement were absent.

## 4. Controlled merge and exact-main CI

Before merge:

- deployment workflow `251547585` was active;
- no staging deployment was queued or in progress;
- the reviewed PR head matched the local and remote head exactly;
- PR #143 was open, draft, mergeable, and exact-head CI green; and
- the worktree was clean.

Workflow `251547585` was disabled and verified `disabled_manually`. A second check confirmed there
was no active real deployment. PR #143 was then marked ready and squash-merged with the exact-head
guard.

The resulting `main` release was
`404c9f949bc4d24973ecf1290f99ff640c422dd3`.

Exact-main CI run `31668889087` completed successfully on that exact SHA. All required jobs were
green, including E2E, Build, and Build & Push Images. The published multi-platform image indexes
were:

| Artifact | CI image index digest                                                     |
| -------- | ------------------------------------------------------------------------- |
| Web      | `sha256:868c188acabee4806a8facfcf66d71f0da4cfda30100b365ae542e8de2e10560` |
| Worker   | `sha256:e9d62369dd839a88274a48ada6f40a9d0df606f4060829b0d28bcc703572b542` |

Deployment remained disabled throughout CI and image publication. No deployment run was created
for the Unit 9 SHA while disabled.

After exact-main CI:

- the main tip still matched the merged release SHA;
- the workflow was re-enabled and verified `active`;
- the latest deployment-run ID remained unchanged after a bounded observation period;
- no workflow-run deployment appeared for the Unit 9 SHA; and
- exactly one manual dispatch was issued.

## 5. Single deployment and live identity

Manual deployment run `31669434639` completed successfully for
`404c9f949bc4d24973ecf1290f99ff640c422dd3`. No second dispatch was issued. The built-in recovery
step was skipped because no deployment failure occurred.

The pipeline passed:

- staging rollback-source capture;
- immutable image existence checks;
- password-reset delivery contract verification;
- migration application;
- worker update and readiness;
- password-reset cutover compatibility validation;
- password-reset reconciler update and preflight;
- web update;
- delayed-waker and invitation-lifecycle job updates;
- job-template and container-environment validation;
- health and Azure deployment-mode validation;
- exact web revision, image, and traffic verification; and
- final worker readiness.

Quick health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `404c9f949bc4d24973ecf1290f99ff640c422dd3` |
| Revision              | `ca-vaultspace-web--0000299`               |
| Degraded capabilities | none                                       |

## 6. Workload coherence and rollback posture

Independent Azure verification used the explicit VaultSpace staging subscription on every query.
No other project subscription was queried for VaultSpace resources.

The web workload has one active revision at 100 percent traffic:

- revision: `ca-vaultspace-web--0000299`;
- health: Healthy;
- provisioning: Provisioned;
- replicas at verification: 1; and
- runtime image digest:
  `sha256:4819492adcd06ce94d7428e37d5178f0ff25df6b59e2647a81c648e19becdf53`.

The worker and all three jobs use one coherent runtime worker digest:

`sha256:e2fc717b30b0766af873d0ec182c41b5eff537486efacf5f4305d74dbc741835`

| Workload                        | Result                             |
| ------------------------------- | ---------------------------------- |
| `ca-vaultspace-worker--0000282` | Healthy, Provisioned, ScaledToZero |
| delayed-waker job               | Succeeded, deployed worker digest  |
| invitation-lifecycle job        | Succeeded, deployed worker digest  |
| password-reset reconciler job   | Succeeded, deployed worker digest  |

The required rollback revisions remain retained, inactive, Healthy, and Provisioned:

| Workload | Revision                        | Runtime digest                                                            |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| Web      | `ca-vaultspace-web--0000297`    | `sha256:452a12540b50b91932d501800d53952b04db769260c195641e229c0b474400a2` |
| Web      | `ca-vaultspace-web--0000298`    | `sha256:bc13e519e6e21f8bde4f37d71ad258c74f109781803b0d9fd7f32410e22991ad` |
| Worker   | `ca-vaultspace-worker--0000280` | `sha256:83e64e98e79916588b3210dd7b99df4294a195632091b6ed2904ca12cfa40cb4` |
| Worker   | `ca-vaultspace-worker--0000281` | `sha256:542299c359c0080fcad0ddf27720ae972b7a808fc72884be7e78b8d8f4087627` |

No revision, image, Azure resource, or rollback artifact was deleted. The deploy workflow remains
active.

## 7. Production catalog acceptance

Catalog verification used a process-local connection obtained from the existing VaultSpace Key
Vault. The secret value was not printed, persisted, written to a file, copied into evidence, or
placed literally in shell history.

Migration `20260813050000_w1_2_bounded_bulk_session_revocation` is finished and has not been rolled
back.

### 7.1 Exact nine-function runtime matrix

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

No other public `bootstrap_*` function is executable by `vaultspace_app`.

The generic primitives remain owner-only:

| Function                                              | `vaultspace_app` | PUBLIC | Owner   |
| ----------------------------------------------------- | ---------------- | ------ | ------- |
| `bootstrap_session_revoke_user_org_v1(text, text)`    | denied           | denied | EXECUTE |
| `bootstrap_session_revoke_user_global_v1(text, text)` | denied           | denied | EXECUTE |

PUBLIC has no EXECUTE ACL on any public `bootstrap_*` function.

### 7.2 New wrapper contracts

All three bounded wrappers are:

- owned by `vaultspace_bootstrap_owner`;
- SQL-language functions;
- `SECURITY DEFINER`;
- volatile;
- parallel unsafe;
- configured with `search_path=pg_catalog`;
- contract-marked; and
- source-checksummed against the reviewed migration.

| Wrapper                        | Contract marker                                                           | Source SHA-256                                                     |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| self-other-session revoke      | `vaultspace-contract:w1-2-session-revoke-self-others-v1`                  | `4e23e309a5a10ec0691eb2bea2181a8f0cf4ddef8c94a24c22ec7b566742a387` |
| admin user-org revoke          | `vaultspace-contract:w1-2-session-revoke-admin-user-org-v1`               | `ea43d78e7c5c1f35a0182de1c6f1404e96063d4cedad2f4ed11e8289ec02b470` |
| admin global single-org revoke | `vaultspace-contract:w1-2-session-revoke-admin-user-global-single-org-v1` | `e8a5a54cc631ed26da6f6cf36260d2ba3d8f3d567bf081d4078a0e2ff87a9b2d` |

### 7.3 Owner and policy posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- without direct or transitive role memberships; and
- unreachable directly or transitively by `vaultspace_app`.

Table-level session `INSERT`, `UPDATE`, and `DELETE` are all false for the owner. The existing
reviewed column-scoped writes remain the only session-write privileges.

The owner-only `bootstrap_owner_membership_inventory` policy is present as a permissive SELECT
policy over `user_organizations`. It enables the approved all-memberships single-organization
invariant without extending the owner role's write privileges or runtime reachability.

## 8. CloudVault acceptance

The included Unit 9 runner targeted the exact live release, retained CloudVault organization, and
dedicated synthetic identities. It passed `8/8` grouped checks:

| Group                                                                               | Result |
| ----------------------------------------------------------------------------------- | ------ |
| Exact release health                                                                | PASS   |
| Migration, membership policy, owner posture, checksums, and exact nine-function ACL | PASS   |
| Password change preserves actor and revokes another warmed same-user session        | PASS   |
| Admin role change revokes only the target CloudVault session                        | PASS   |
| Viewer and cross-organization attempts are neutral and non-mutating                 | PASS   |
| Shared-identity global change is rejected without revoking either organization      | PASS   |
| Single-organization two-factor reset revokes all target sessions                    | PASS   |
| Login, session, organization resolve, logout, and unknown-token regressions         | PASS   |

The matrix exercised warmed-cache revocation and verified that a revoked session is denied after
targeted `session:v2:<sessionId>` eviction. It did not expose bearer tokens in SQL results, cache
keys, logs, or evidence.

After the matrix, all synthetic users, memberships, sessions, and the temporary sibling
organization were soft-disabled. The retained CloudVault organization was preserved. No room or
document content matrix was run.

## 9. Brightside bounded smoke

CloudVault acceptance was green before Brightside access. The user established an authenticated
Brightside session on the canonical application host. The bounded smoke did not use a QA account,
did not inspect browser cookies or storage, and did not enumerate customer rooms or content.

The authenticated shell presented exactly one known room route. That route was used directly. The
rooms index, folders, documents, shared links, previews, downloads, exports, and customer content
were not opened.

| Check                                               | Result |
| --------------------------------------------------- | ------ |
| Authenticated canonical shell                       | PASS   |
| Brightside organization identity                    | PASS   |
| Single previously known protected room route        | PASS   |
| Logout through the application account menu         | PASS   |
| Direct protected-route re-entry after logout denied | PASS   |

The known protected route loaded the authenticated application main region with no login form,
fatal error, or not-found state. Logout returned the browser to the canonical login route. A direct
attempt to revisit the same protected route remained on the login page and exposed no
authenticated shell. The Brightside account was left logged out.

No room identifier, room title, folder name, document name, document metadata, shared-link detail,
preview, download, export, or content is included in this evidence.

## 10. Credential and environment boundary

The public web workload still contains exactly one `DATABASE_URL_ADMIN` environment entry as a
secret reference. No literal connection value was present in the inspected template.
`DATABASE_URL_ADMIN` was not removed or altered.

A locally recorded legacy demo credential was rejected neutrally before the user established the
Brightside session. It was not retried, reset, copied into this evidence, committed, or placed in PR
text. No unrelated QA account was substituted for Brightside acceptance.

No credential value, database URL, token, cookie, session ID, customer identifier, customer
content, or private Azure secret is present in this document.

## 11. Status and next gate

**W1-2 UNIT 9 BOUNDED BULK SESSION REVOCATION: DEPLOYED, EXACT NINE-FUNCTION CATALOG GREEN,
CLOUDVAULT 8/8 GROUPS GREEN, BRIGHTSIDE 5/5 GREEN, PENDING WRITTEN ADVISOR CLOSE-OUT.**

Standing status:

- W1-1: CLOSED
- W1-2 Units 1 through 8: ACCEPTANCE-CLOSED
- W1-2 Unit 9: deployed and technically green, pending written Advisor close-out
- Live: `404c9f949bc4d24973ecf1290f99ff640c422dd3 / ca-vaultspace-web--0000299`
- Runtime EXECUTE: exact nine-function matrix
- Generic bulk revoke: OWNER-ONLY
- Admin URL: STILL PRESENT
- W1-2 overall: OPEN
- W1-3: NOT STARTED
- Deploy workflow: ACTIVE
- Freeze: ACTIVE
- P0-4: ACCEPTED and unchanged

The next implementation unit requires separate analysis and authorization. This document does not
authorize password-reset conversion, account-lifecycle conversion, admin URL removal, W1-3
enforcement, rollback retirement, or any additional staging dispatch.

## References

- Advisor authorization `ADV-2026-08-13-03`
- Advisor premerge authorization `ADV-2026-08-13-04`
- Source PR #143
- Exact-head CI run `31667853221`
- Exact-main CI run `31668889087`
- Single staging deploy run `31669434639`
- `docs/W1_2_BOUNDED_BULK_SESSION_REVOCATION_IMPLEMENTATION_2026-08-13_v1.md`
- `docs/W1_2_BULK_SESSION_REVOCATION_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `prisma/migrations/20260813050000_w1_2_bounded_bulk_session_revocation/migration.sql`
- `scripts/cloudvault-w1-2-bounded-bulk-session-revocation-acceptance-v1.cjs`
