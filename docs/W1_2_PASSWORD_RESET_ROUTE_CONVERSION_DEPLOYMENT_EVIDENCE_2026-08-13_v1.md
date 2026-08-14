# W1-2 Unit 11 Password Reset Route Conversion Deployment Evidence

- Date: 2026-08-13
- Advisor authorizations: `ADV-2026-08-13-13` and `ADV-2026-08-13-14`
- Unit: W1-2 Unit 11, password-reset redemption route conversion
- Source PR: #149
- Reviewed PR head: `a729c7f6b978d3926b0317259ab711253595219a`
- Deployed release: `5d63d4b73126de088aa42ce2fa6a382683f63de9`
- Live web revision: `ca-vaultspace-web--0000301`
- Live worker revision: `ca-vaultspace-worker--0000284`
- Result: Exact eleven-function runtime catalog, route conversion, and CloudVault `7/7` green
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Outcome

W1-2 Unit 11 is deployed and technically acceptance-green, pending written Stakeholder Advisor
close-out.

The live `POST /api/auth/reset-password` route now uses the ordinary `db` connection and
`PasswordResetCapabilityRepository`. It no longer imports or calls `bootstrapDb`. The application
runtime EXECUTE matrix expanded from the nine Unit 9 functions to exactly eleven approved
functions by granting:

1. `bootstrap_password_reset_candidate_v1(text)`; and
2. `bootstrap_password_reset_redeem_v1(text, text)`.

The successful sequence completed with:

- exact-head guarded squash merge of PR #149;
- exact-main CI and immutable image publication while deployment was disabled;
- no side-effect deployment when workflow `251547585` was re-enabled;
- exactly one manual staging dispatch;
- successful Unit 11 migration application;
- one coherent web, worker, delayed-waker, invitation-lifecycle, and password-reset-reconciler
  release;
- exact production catalog acceptance;
- CloudVault `7/7` grouped acceptance;
- synthetic-user soft cleanup;
- retention of the required Unit 10 rollback revisions; and
- authorized removal of only the two disposable local Unit 11 containers.

W1-2 overall remains open. This evidence does not authorize reset issuance conversion,
retirement of the direct reset-table privilege residual, removal of `DATABASE_URL_ADMIN`, W1-3
enforcement, rollback retirement, or another deployment dispatch.

## 2. Authorized and deployed boundary

The converted route performs the following sequence:

1. It derives the non-reversible stored reset-token lookup from the presented capability.
2. It calls `bootstrap_password_reset_candidate_v1(text)` before BCrypt cost-12 hashing.
3. It computes the replacement password hash only after the database candidate proof succeeds.
4. It opens one ordinary-role `db.$transaction`.
5. It establishes bootstrap context and invokes
   `bootstrap_password_reset_redeem_v1(text, text)` through the typed repository.
6. It derives every organization audit scope from the validated SQL result envelope.
7. It sets `app.current_org_id` transaction-locally on the existing transaction, without a nested
   `withOrgContext` transaction.
8. It writes completion and supersession security audits inside the same transaction.
9. It commits the password update, token claim, recovery wipe, session revocation, and audits
   atomically.
10. It evicts returned `session:v2:<sessionId>` Redis keys only after commit.

If post-commit cache eviction fails, the route records only a categorical failure. Live
PostgreSQL session resolution remains authoritative and denies revoked sessions.

Invalid, expired, malformed, already-used, candidate-failed, and redemption-race outcomes use the
same HTTP 400 response:

`{"error":"Invalid or expired password reset token"}`

The route contains no direct password-reset table mutation, direct user-password mutation, direct
session mutation, caller-supplied subject identity, caller-supplied organization scope, nested
organization transaction, `bootstrapDb` import, or administrative fallback.

The following boundaries remain excluded:

- anonymous reset issuance and administrator reset issuance conversion;
- administrator cancellation and account-lifecycle conversion;
- provider delivery-transition conversion;
- revocation of the temporary direct runtime reset-table privileges;
- registration, public-link, viewer-session, or access-request conversion;
- `DATABASE_URL_ADMIN` removal;
- W1-3 or P0-4 changes;
- rollback revision retirement; and
- a second deployment dispatch.

## 3. Premerge implementation verification

PR #149 remained at exact reviewed head
`a729c7f6b978d3926b0317259ab711253595219a`. Exact-head CI run `31752903876` completed
successfully across all 11 required jobs:

- Security Scan;
- Provider Event Inbox Integration;
- RLS Integration;
- standalone deployment-mode tests;
- Azure deployment-mode tests;
- Lint and clean-checkout Prettier;
- Test;
- Type Check;
- E2E, including the password-reset first-dashboard browser test;
- Build; and
- Docker Build for web and worker Azure-mode images.

Premerge local verification also passed:

| Verification                                          | Result                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| Full unit suite                                       | 1,385 passed across 148 passing files; 7 skipped |
| Focused Unit 11 contracts                             | 28/28 passed                                     |
| RLS integration                                       | 94/94 passed across 9 files                      |
| Unit 11 PostgreSQL real-role matrix                   | 9/9 passed                                       |
| PostgreSQL 15 fresh migration chain                   | 51/51 passed in two disposable databases         |
| Production-like nine-to-eleven transition             | passed                                           |
| Production-like reset ACL preservation                | exact 152 keys preserved                         |
| TypeScript, ESLint, scoped Prettier, production build | passed                                           |

The migration preflight proves the exact Unit 10 nine-function prestate and both password-reset
function contracts before entering the explicit DDL transaction. The transaction snapshots the
152-key runtime reset ACL residual, grants only the two approved functions, restores zero owner
membership, proves the exact eleven-function poststate, and confirms the residual is unchanged.
Both ACL array comparisons use explicit `COLLATE pg_catalog."C"` ordering.

Human review rechecked:

- candidate proof before BCrypt cost-12 hashing;
- one ordinary-role transaction for redemption and audits;
- no nested `withOrgContext`;
- organization context derived only from the SQL envelope;
- deterministic completion and supersession idempotency keys;
- post-commit session-ID cache eviction;
- identical neutral denial responses;
- exact eleven-function catalog assertions;
- owner-only generic bulk-revocation functions;
- no direct reset-table route mutation;
- no `DATABASE_URL_ADMIN` removal; and
- no W1-3 or unrelated application change.

## 4. Controlled merge and exact-main CI

Before merge:

- PR #149 was open, draft, mergeable, and exact-head CI green;
- the PR head matched `a729c7f6b978d3926b0317259ab711253595219a`;
- deploy workflow `251547585` was active;
- zero queued or active real staging deployments existed; and
- the two unrelated user worktree files remained untouched and unstaged.

Workflow `251547585` was disabled and verified `disabled_manually`. Active deploy count remained
zero. PR #149 was marked ready and squash-merged using GitHub's exact-head guard. The resulting
`main` release was `5d63d4b73126de088aa42ce2fa6a382683f63de9`.

Exact-main CI run `31753640064` completed successfully. Every required job passed, including E2E,
Build, and Build & Push Images. Deployment remained disabled throughout merge, CI, and image
publication. No staging deployment run was created while held.

The exact-SHA multi-platform ACR indexes were published before deployment:

| Artifact | CI image index digest                                                     |
| -------- | ------------------------------------------------------------------------- |
| Web      | `sha256:645d11dff278177cb505dff10c76e1c4ca3e1e608470b9b369d289b20652af0e` |
| Worker   | `sha256:d99058da996f4f5d7ab2fb682096a7d137a10d3d54eb580f456d626a14e46182` |

The workflow was re-enabled and verified `active`. Its run list was unchanged before and after
re-enablement, proving zero side-effect deploy. A final pre-dispatch query found zero deploy runs
for the Unit 11 SHA.

## 5. Single staging deployment

Exactly one manual staging dispatch was issued for the unchanged `main` SHA. Deploy run
`31754212480` completed successfully in 6 minutes 47 seconds. A post-run query found exactly one
deploy run for the release SHA. No second dispatch was issued, and the rollback step was skipped.

The pipeline passed:

- deployment-variable validation;
- Azure OIDC login;
- rollback-source capture;
- exact web and worker image existence checks;
- password-reset delivery contract verification;
- migration application through the dedicated migration connection;
- worker update, exact-image verification, and readiness;
- password-reset cutover compatibility verification;
- password-reset reconciler update and preflight;
- web update;
- delayed-waker and invitation-lifecycle job updates;
- job-template and Container App environment-shape validation;
- health and Azure deployment-mode validation;
- exact web revision, image, sole-active status, and 100 percent traffic convergence; and
- final worker readiness.

Migration `20260813220000_w1_2_password_reset_redemption_route_conversion` is complete:

| Migration                                                        | Finished | Rolled back | Applied steps |
| ---------------------------------------------------------------- | -------- | ----------- | ------------- |
| `20260813220000_w1_2_password_reset_redemption_route_conversion` | yes      | no          | 1             |

No Prisma migration resolution, manual DDL, database repair, retry, or second deployment was
required.

## 6. Live identity, coherence, and rollback posture

Independent quick health returned HTTP 200:

| Field                      | Result                                     |
| -------------------------- | ------------------------------------------ |
| Status                     | healthy                                    |
| Mode                       | azure                                      |
| Release                    | `5d63d4b73126de088aa42ce2fa6a382683f63de9` |
| Revision                   | `ca-vaultspace-web--0000301`               |
| Degraded capabilities      | none                                       |
| Database                   | healthy                                    |
| Distributed cache          | healthy                                    |
| Storage                    | healthy                                    |
| Password-reset reader      | version 1                                  |
| Password-reset writer      | hmac                                       |
| Recovery delivery contract | version 1                                  |

Independent Azure queries used the explicit VaultSpace staging subscription on every command.
The web workload has one active revision at 100 percent traffic:

- revision: `ca-vaultspace-web--0000301`;
- health: Healthy;
- provisioning: Provisioned; and
- runtime image digest:
  `sha256:df515c212d53f8420544d0fcbc8bec661000801665a143a3ef2289d4e941d2bd`.

The worker and all three jobs use one coherent worker runtime digest:

`sha256:3420cc4bf57408f2aa660067dcbc5ff3fcf0da2c987ecb157c47d410a0c03ce8`

| Workload                        | Result                            |
| ------------------------------- | --------------------------------- |
| `ca-vaultspace-worker--0000284` | Healthy and Provisioned           |
| delayed-waker job               | Succeeded, deployed worker digest |
| invitation-lifecycle job        | Succeeded, deployed worker digest |
| password-reset reconciler job   | Succeeded, deployed worker digest |

The required Unit 10 rollback revisions remain retained, inactive, Healthy, and Provisioned:

| Workload | Revision                        | Runtime digest                                                            |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| Web      | `ca-vaultspace-web--0000300`    | `sha256:d11d274aa75aebdd129cb5a0d686133c7ab6b8e53925168b601f921051c9e633` |
| Worker   | `ca-vaultspace-worker--0000283` | `sha256:d0390f991dd47787aa2b17019ec62bb120bf1d382d426b40cd2e2f7a4bf3d63a` |

No rollback revision, image, Azure resource, or rollback artifact was deleted. The deploy workflow
remains active.

## 7. Production catalog acceptance

Catalog verification used a process-local connection obtained from the existing web secret
reference. The connection value was not printed, persisted, written to a file, copied into
evidence, or placed literally in shell history.

### 7.1 Exact eleven-function runtime matrix

`vaultspace_app` has EXECUTE on exactly these eleven `bootstrap_*` functions:

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
| `bootstrap_password_reset_candidate_v1(text)`                                         | yes             |
| `bootstrap_password_reset_redeem_v1(text, text)`                                      | yes             |

The runtime count is 11. The unexpected count and missing count are both zero.

The generic bulk-revocation functions remain unavailable to the runtime role:

| Function                                              | `vaultspace_app` | PUBLIC | Owner   |
| ----------------------------------------------------- | ---------------- | ------ | ------- |
| `bootstrap_session_revoke_user_org_v1(text, text)`    | denied           | denied | EXECUTE |
| `bootstrap_session_revoke_user_global_v1(text, text)` | denied           | denied | EXECUTE |

PUBLIC has no EXECUTE ACL on any public `bootstrap_*` function.

### 7.2 Password-reset function contracts

Both password-reset functions remain:

- owned by `vaultspace_bootstrap_owner`;
- `SECURITY DEFINER`;
- parallel unsafe;
- configured with `search_path=pg_catalog`;
- contract-marked; and
- source-checksummed against the reviewed Unit 10 migration.

| Function                                | Language | Volatility | Contract marker                                        | Source MD5                         |
| --------------------------------------- | -------- | ---------- | ------------------------------------------------------ | ---------------------------------- |
| `bootstrap_password_reset_candidate_v1` | SQL      | stable     | `vaultspace-contract:w1-2-password-reset-candidate-v1` | `fb2338b2271dcbe38ddb05f4b7a55e65` |
| `bootstrap_password_reset_redeem_v1`    | PL/pgSQL | volatile   | `vaultspace-contract:w1-2-password-reset-redeem-v1`    | `be86d46853493dc7dba68cfba0b68c4b` |

The candidate result remains limited to `TABLE(candidate_proven boolean)`. The redeem function
returns the reviewed server-only typed envelope and no raw bearer token.

### 7.3 Owner and residual privilege posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- without direct or transitive role-membership edges; and
- unreachable by `vaultspace_app`.

The owner retains zero table-level `INSERT`, `UPDATE`, or `DELETE` privileges on sessions,
password-reset tokens, and password-reset recoveries. The exact 152-key direct runtime privilege
residual across reset tokens and recoveries remains unchanged. No reset-table privilege was added
or removed in Unit 11.

## 8. CloudVault Unit 11 acceptance

The operator-gated runner targeted:

- `https://vaultspace.org`;
- exact release `5d63d4b73126de088aa42ce2fa6a382683f63de9`; and
- the retained organization `cloudvault-w1-2-verify`, whose exact name remains `CloudVault`.

It passed `7/7` grouped checks:

| Check                                                                         | Result |
| ----------------------------------------------------------------------------- | ------ |
| Health matches exact Unit 11 release                                          | PASS   |
| Migration, exact eleven-function ACL, owner posture, and residual             | PASS   |
| Session resolve, warmed cache, and organization resolve regressions           | PASS   |
| Legacy capability redemption atomically mutates, audits, and revokes sessions | PASS   |
| Post-commit cache eviction and live projection deny every revoked session     | PASS   |
| Old password fails and replacement password creates a valid session           | PASS   |
| Used, expired, malformed, and unknown capabilities share one neutral denial   | PASS   |

The matrix additionally proved:

- exact CloudVault identity and organization scope;
- primary and secondary subject sessions were valid before redemption;
- the secondary session cache was warmed before revocation;
- completion and supersession audit rows were committed with the reviewed idempotency keys;
- presented recovery ciphertext was wiped and its state became redeemed;
- sibling reset flow was superseded;
- both subject sessions returned 401 after redemption;
- an unrelated control user's session remained valid;
- the old password returned 401;
- the replacement password created a live session;
- logout invalidated the replacement session; and
- every neutral denial returned the exact approved HTTP 400 body.

After the green matrix, synthetic users, memberships, and sessions were soft-disabled. The
retained CloudVault organization was preserved. No customer record, room, document, link,
preview, download, export, or content matrix was accessed.

## 9. Cleanup, credential, and worktree boundary

The explicitly authorized local cleanup removed only these two disposable containers:

- `vaultspace-w1-2-unit11-route-v1`; and
- `vaultspace-w1-2-unit11-route-v2`.

Their anonymous Docker volumes and the shared PostgreSQL image were not removed because they were
not authorized cleanup targets. No file was deleted.

The public web workload still contains exactly one `DATABASE_URL_ADMIN` environment entry backed
by its existing secret reference. No literal connection value was present in the inspected
template. `DATABASE_URL_ADMIN` was not removed or altered.

No connection string, private key, token, cookie, password, PAT, customer identifier, or customer
content is present in this document.

The following unrelated user worktree files remained untouched and were not staged for this
evidence branch:

- `dataroom-feature-matrix-v6.md`; and
- `docs/SYSOP_DEVOPS_CONTROL_PLANE_DESIGN.md`.

## 10. Status and next gate

**W1-2 UNIT 11 PASSWORD RESET ROUTE CONVERSION: DEPLOYED, EXACT ELEVEN-FUNCTION RUNTIME CATALOG
GREEN, CLOUDVAULT 7/7 GREEN, PENDING WRITTEN ADVISOR CLOSE-OUT.**

Standing status:

- W1-1: CLOSED
- W1-2 Units 1 through 10: ACCEPTANCE-CLOSED
- W1-2 Unit 11: deployed and technically green, pending written Advisor close-out
- Live: `5d63d4b73126de088aa42ce2fa6a382683f63de9 / ca-vaultspace-web--0000301`
- Runtime EXECUTE: exact eleven-function matrix
- Generic bulk revoke: OWNER-ONLY
- Password-reset redemption: ROUTED through ordinary-role capability functions
- Direct reset-table runtime privilege residual: PRESENT and unchanged
- Admin URL: STILL PRESENT
- W1-2 overall: OPEN
- W1-3: NOT STARTED
- Deploy workflow: ACTIVE
- Freeze: ACTIVE
- P0-4: ACCEPTED and unchanged

This document does not authorize reset issuance conversion, reset-table privilege retirement,
admin URL removal, W1-3 enforcement, rollback retirement, or any additional staging dispatch.

## References

- Advisor architecture authorization `ADV-2026-08-13-13`
- Advisor premerge and deployment authorization `ADV-2026-08-13-14`
- Source PR #149
- PR #149 exact-head CI run `31752903876`
- Exact-main CI run `31753640064`
- Successful single staging deploy run `31754212480`
- `docs/W1_2_PASSWORD_RESET_ROUTE_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_ROUTE_CONVERSION_IMPLEMENTATION_2026-08-13_v1.md`
- `prisma/migrations/20260813220000_w1_2_password_reset_redemption_route_conversion/migration.sql`
- `scripts/cloudvault-w1-2-password-reset-route-acceptance-v1.cjs`
