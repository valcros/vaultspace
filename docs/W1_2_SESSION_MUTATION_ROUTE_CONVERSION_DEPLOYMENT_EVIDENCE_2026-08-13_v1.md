# W1-2 Session Mutation Route Conversion Deployment Evidence

- **Date:** 2026-08-13
- **Advisor authorization:** `ADV-2026-08-13-01`
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Session create, sliding refresh, and exact-token invalidation conversion
- **Source PR:** #141
- **Reviewed source head:** `c52b57a2a4b45f82fe0ffad9d2495b73ee95edf3`
- **Merge commit and deployed release:** `691524ce0088b3db8dffe1b60ad60a5515b3e80e`
- **Exact-head PR CI:** `31651452507`, success
- **Exact-main CI:** `31654685120`, success
- **Deployment:** `31655240416`, one dispatch, success
- **Live web revision:** `ca-vaultspace-web--0000297`
- **Result:** Deployment, six-function catalog posture, CloudVault mutation-family acceptance, and
  bounded Brightside smoke green
- **W1-2 Unit 8 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

Unit 8 converted one coherent session-mutation family after Unit 7 had already established and
deployed the owner-only functions. This unit:

- granted `vaultspace_app` execution on `bootstrap_session_create_v1`;
- granted `vaultspace_app` execution on `bootstrap_session_refresh_v1`;
- granted `vaultspace_app` execution on `bootstrap_session_invalidate_v1`;
- retained the existing login-candidate, session-resolve, and organization-resolve grants;
- routed password login, two-factor completion, registration, and setup session creation through
  the constrained create function;
- preserved the password-login organization-scoped transaction and last-login update;
- routed activity refresh through the constrained refresh function;
- evicted the token-keyed Redis entry only after a successful authoritative refresh;
- routed logout and shared exact-token invalidation through the constrained invalidate function;
  and
- retained live session resolution as the authorization source of truth, with Redis remaining an
  accelerator only.

This unit did not:

- grant app execution on user/organization or global bulk revoke;
- route either bulk-revoke function from a live production path;
- convert password-change or membership-wide session invalidation;
- introduce a `bootstrapDb` fallback on any converted mutation path;
- remove or change `DATABASE_URL_ADMIN`;
- change the migration entrypoint model;
- change W1-3, P0-4, networking, DNS, certificates, or private connectivity;
- run a second deploy;
- access CloudVault room or document content; or
- enumerate or open Brightside folders, documents, links, previews, downloads, or exports.

## 2. Human review and exact-head validation

Human review covered the complete PR #141 diff and confirmed:

- the migration first proves the prior three-function runtime matrix and fails closed on drift;
- the post-migration runtime matrix contains exactly six approved `bootstrap_*` functions;
- both bulk-revoke functions remain owner-only;
- `PUBLIC` remains denied on every public `bootstrap_*` function;
- the owner role posture, source checksums, contract markers, session privileges, and zero residual
  memberships are asserted before commit;
- the owner has column-scoped session writes only and no table-level `INSERT`, `UPDATE`, or
  `DELETE`;
- password login still creates the session and updates `lastLoginAt` inside the same
  organization-scoped transaction;
- password login, two-factor completion, registration, and setup use the shared constrained
  session-creation path;
- activity refresh passes the opaque token to the constrained function and evicts the token cache
  after success;
- logout performs exact-token invalidation without an administrative database fallback;
- Redis cannot independently authorize a session;
- bulk-revoke repository methods remain unimported by production session helpers; and
- the admin URL, W1-3, and P0-4 remain outside the diff.

The reviewed source head was `c52b57a2a4b45f82fe0ffad9d2495b73ee95edf3`. Exact-head PR CI run
`31651452507` completed successfully. Lint, formatting, type checking, unit tests, RLS integration,
provider integration, E2E, production build, Docker build, security scan, and Azure and standalone
deployment-mode tests were green.

## 3. Authorized local cleanup

The following disposable PostgreSQL containers were stopped when needed and removed exactly as
authorized:

- `vaultspace-w1-2-session-mutation-route-v1`;
- `vaultspace-w1-2-session-mutation-route-v2`; and
- `vaultspace-w1-2-session-mutation-route-azure-v1`.

No other container, image, volume, file, Azure resource, database object, or production record was
deleted.

## 4. Controlled merge and exact-main CI

Before merge:

- workflow `251547585` was active;
- no real deploy job was in progress;
- historical queued run `31428108038` remained an inert 2026-08-10 record with zero jobs and no
  pending environment deployment;
- the deploy workflow was disabled and verified as `disabled_manually`;
- PR #141 remained mergeable with a clean merge state;
- the PR head still matched the reviewed SHA exactly; and
- production remained healthy on the post-Unit-7 evidence successor
  `b3694487169336303592a18d20afda9e250494d6 / ca-vaultspace-web--0000296`.

PR #141 was marked ready and squash-merged with the exact-head guard. The resulting `main` SHA was
`691524ce0088b3db8dffe1b60ad60a5515b3e80e`.

Exact-main CI run `31654685120` completed successfully on that SHA. E2E passed, and the web and
worker images for the exact main SHA were published. No deploy run was created while workflow
`251547585` was disabled.

After exact-main CI:

- `origin/main` still equaled the approved merge SHA;
- the deploy workflow was re-enabled and verified `active`;
- enablement did not replay the completed CI event or start a side-effect deployment;
- no run for the Unit 8 SHA existed before manual dispatch; and
- exactly one manual dispatch was issued.

## 5. Single deployment and live identity

Deploy run `31655240416` completed successfully for
`691524ce0088b3db8dffe1b60ad60a5515b3e80e`. No second dispatch was issued, and the automated
recovery step was skipped.

The pipeline passed:

- rollback-source capture;
- immutable image existence and digest resolution;
- password-reset delivery contract verification;
- migration application;
- worker update and readiness;
- password-reset reconciler update, compatibility validation, and preflight;
- web update;
- delayed-waker and invitation-lifecycle job updates;
- container environment validation;
- deployment-mode health;
- exact web revision, image, and traffic convergence; and
- final worker readiness.

The web transition converged on the second bounded check to one healthy exact-release revision at
100 percent traffic.

Quick health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                  | Result                                     |
| ---------------------- | ------------------------------------------ |
| Status                 | healthy                                    |
| Mode                   | azure                                      |
| Release                | `691524ce0088b3db8dffe1b60ad60a5515b3e80e` |
| Revision               | `ca-vaultspace-web--0000297`               |
| Degraded capabilities  | none                                       |
| Reset token write mode | hmac                                       |
| Recovery configured    | true                                       |

## 6. Workload coherence and rollback posture

Independent read-only Azure verification selected the explicit VaultSpace staging subscription
before querying resources.

The web workload has exactly one active revision at 100 percent traffic:

- revision: `ca-vaultspace-web--0000297`;
- health: Healthy;
- provisioning: Provisioned;
- replicas at verification: 2; and
- digest: `sha256:452a12540b50b91932d501800d53952b04db769260c195641e229c0b474400a2`.

The worker and all three jobs use one coherent worker digest:

`sha256:83e64e98e79916588b3210dd7b99df4294a195632091b6ed2904ca12cfa40cb4`

| Workload                         | Result                             |
| -------------------------------- | ---------------------------------- |
| `ca-vaultspace-worker--0000280`  | Healthy, Provisioned, ScaledToZero |
| `ca-vaultspace-delayed-waker`    | Succeeded, deployed worker digest  |
| `ca-vaultspace-invite-lifecycle` | Succeeded, deployed worker digest  |
| `ca-vaultspace-pwreset-recon`    | Succeeded, deployed worker digest  |

The captured immediate prior rollback artifacts remain retained:

- web revision `ca-vaultspace-web--0000296`, digest
  `sha256:7097feb24dd217e46a6f00430261889c264486a3c37fa83d515a838c8ce688f7`; and
- worker revision `ca-vaultspace-worker--0000279`, digest
  `sha256:c839710fcb457b33e20405696cab468bedd7e042f9bf990fb41c9840f8b9857a`.

No revision or image was deleted. The deploy workflow remains active.

## 7. Production catalog acceptance

Catalog verification used a process-local connection obtained from the existing VaultSpace Key
Vault. The secret value was not printed, persisted, written to a file, copied into evidence, or
placed literally in a recorded command. Queries were limited to migration, role, function,
privilege, and the separately authorized synthetic CloudVault fixture records.

Migration `20260812230000_w1_2_session_mutation_route_conversion` is finished and has not been
rolled back.

### 7.1 Owner and session privilege posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION; and
- without direct or transitive role memberships.

The owner still has only the reviewed column-scoped session writes. Independent catalog checks
confirmed table-level session `INSERT`, `UPDATE`, and `DELETE` are all false. The acceptance runner
also confirmed zero runtime reachability to the owner and the complete reviewed column privilege
set.

### 7.2 Exact eight-function ACL matrix

| Function                                                            | App EXECUTE | PUBLIC EXECUTE |
| ------------------------------------------------------------------- | ----------- | -------------- |
| `bootstrap_login_candidate_v1(text)`                                | yes         | no             |
| `bootstrap_session_resolve_v1(text)`                                | yes         | no             |
| `bootstrap_organization_resolve_v1(text,text)`                      | yes         | no             |
| `bootstrap_session_create_v1(text,text,text,timestamptz,text,text)` | yes         | no             |
| `bootstrap_session_refresh_v1(text)`                                | yes         | no             |
| `bootstrap_session_invalidate_v1(text)`                             | yes         | no             |
| `bootstrap_session_revoke_user_org_v1(text,text)`                   | no          | no             |
| `bootstrap_session_revoke_user_global_v1(text,text)`                | no          | no             |

No other public `bootstrap_*` function or overload is executable by `vaultspace_app`.

### 7.3 Mutation-function contract posture

All five mutation functions remain owned by `vaultspace_bootstrap_owner`, use `SECURITY DEFINER`,
have exact `search_path=pg_catalog` configuration, and match the reviewed source checksum and
contract marker.

| Function                                  | Contract marker                                          | Source SHA-256                                                     |
| ----------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `bootstrap_session_create_v1`             | `vaultspace-contract:w1-2-session-create-v1`             | `184e265aa5787f474582b3d72514e7e9f6f287fcf0bdc0a550680eb65650840c` |
| `bootstrap_session_refresh_v1`            | `vaultspace-contract:w1-2-session-refresh-v1`            | `3e266b4bcba9471926160ed1388524d43ddf8c1936adbedeec3b408b34f0e681` |
| `bootstrap_session_invalidate_v1`         | `vaultspace-contract:w1-2-session-invalidate-v1`         | `2919babc1fdb1f9ad0fe9678e547e365c3df7df49bba988892589170bdc3e903` |
| `bootstrap_session_revoke_user_org_v1`    | `vaultspace-contract:w1-2-session-revoke-user-org-v1`    | `7f43a9adde04f440731baeb84eebd3f1740986a22640ad418aa05d2c27194b3d` |
| `bootstrap_session_revoke_user_global_v1` | `vaultspace-contract:w1-2-session-revoke-user-global-v1` | `8ce811e3be405f75f946793c3c6d752a2694ee4b44d66bca878ecd5b5151d35d` |

## 8. CloudVault session-mutation acceptance

The included versioned runner
`scripts/cloudvault-w1-2-session-mutation-route-acceptance-v1.cjs` executed only after the deploy
and exact release identity were green. It targeted the retained active synthetic organization
named exactly `CloudVault` with slug `cloudvault-w1-2-verify`.

The runner generated one dedicated synthetic user and password in process memory. No password,
session token, database URL, or other credential was printed or persisted.

| Grouped acceptance check                                                      | Result |
| ----------------------------------------------------------------------------- | ------ |
| Quick health matches the exact Unit 8 release                                 | PASS   |
| Migration, owner posture, checksums, and exact six-function runtime ACL       | PASS   |
| Login creates one active session with exact CloudVault identity               | PASS   |
| Session resolve and the protected application shell remain authenticated      | PASS   |
| Organization resolve returns only the approved CloudVault branding projection | PASS   |
| Sliding refresh advances the authoritative synthetic-session expiry           | PASS   |
| Logout invalidates the exact token and defeats the warmed token cache         | PASS   |
| An unknown token receives the established neutral 401                         | PASS   |

Result: **8/8 grouped checks PASS**. These grouped checks cover the ten minimum acceptance items in
`ADV-2026-08-13-01`, including health identity, migration state, ACL posture, create, resolve,
organization regression, authoritative refresh, exact-token invalidation, warmed-cache denial,
unknown-token denial, and cleanup.

Final cleanup soft-disabled the synthetic user, CloudVault membership, and sessions. The retained
CloudVault organization remains active. No CloudVault room, folder, document, link, preview,
download, export, or content endpoint was used.

## 9. Brightside bounded smoke

CloudVault acceptance was green before Brightside access. The original Chrome extension transport
disconnected before the smoke. Chrome, the extension, and the native-host configuration all passed
diagnostics. With explicit user authorization, one fresh Chrome window restored the extension
connection. The user then established the Brightside session manually without exposing a
credential to the operator or evidence.

The authenticated canonical shell visibly identified the Brightside organization. Its normal
dashboard rendered one existing room card and its summary. The operation opened only that single
known room route. It did not navigate to the rooms index, a folder, a document, a shared link, a
preview, a download, an export, a user list, or search.

| Authorized check                                      | Result |
| ----------------------------------------------------- | ------ |
| Authenticated Brightside shell                        | PASS   |
| Brightside organization identity                      | PASS   |
| Single known-room route on the canonical host         | PASS   |
| Logout through the application account menu           | PASS   |
| Direct protected-room re-entry after logout is denied | PASS   |

The known-room route loaded the expected room landing and did not show a login form, fatal error,
or not-found state. No room identifier, room title, folder name, document name, document metadata,
link, preview, download, export, or content was copied into this evidence.

Logout returned the browser to the canonical login route. A direct attempt to revisit the same
protected room route remained on the login page. The Brightside account was left logged out.

## 10. Credential and environment boundary

The web workload still contains both ordinary `DATABASE_URL` and `DATABASE_URL_ADMIN` entries as
secret references. No literal connection value was present in the inspected web template.
`DATABASE_URL_ADMIN` was not removed or altered.

A local private configuration read displayed the already-recorded demo credential in operator tool
output. The value was not copied into chat, this evidence, source code, a commit, or PR text. No
credential rotation was mixed into Unit 8.

No W1-3 enforcement, P0-4 change, bulk-revoke grant, bulk-revoke route conversion, entrypoint
cutover, networking change, or second deployment occurred.

## 11. Status and next gate

**W1-2 UNIT 8 SESSION MUTATION ROUTE CONVERSION: DEPLOYED, EXACT SIX-FUNCTION CATALOG GREEN,
CLOUDVAULT MUTATION MATRIX GREEN, BRIGHTSIDE MINIMAL SMOKE GREEN, PENDING WRITTEN ADVISOR
CLOSE-OUT.**

W1-2 overall remains OPEN. Runtime execution is limited to the three established resolve functions
plus session create, refresh, and exact-token invalidate. Both bulk-revoke functions remain
owner-only and unrouted. `DATABASE_URL_ADMIN` remains present on the public web workload. W1-3 is
not started. The security freeze remains active. P0-4 remains accepted and unchanged.

## References

- Advisor reply `ADV-2026-08-13-01`
- Source PR #141
- Exact-head CI run `31651452507`
- Exact-main CI run `31654685120`
- Deploy run `31655240416`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_ROUTE_CONVERSION_VALIDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
- `prisma/migrations/20260812230000_w1_2_session_mutation_route_conversion/migration.sql`
- `scripts/cloudvault-w1-2-session-mutation-route-acceptance-v1.cjs`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/lib/auth/session.ts`
