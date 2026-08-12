# W1-2 Session Bootstrap Foundation Deployment Evidence

- **Date:** 2026-08-12
- **Execution time:** 2026-08-11 America/Los_Angeles
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Additive session-resolve foundation
- **Source PR:** #129
- **Source head:** `837fae68095d73edb41dc9fe26023d1f3f973357`
- **Merge commit and deployed release:** `b9c2e0018d5e0727f8cfe515d2e335c46ecafe96`
- **PR CI:** `31556157351`, attempt 2 success
- **Main CI:** `31559902373`, success
- **Deployment:** `31560478351`, success
- **Result:** Deployment, live catalog posture, workload coherence, and bounded CloudVault smoke green
- **W1-2 Unit 2 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit deployed the additive session bootstrap foundation approved by the Stakeholder Advisor.
It:

- granted the existing NOLOGIN `vaultspace_bootstrap_owner` role `SELECT` on `public.sessions`;
- created `public.bootstrap_session_resolve_v1(text)` as one exact SECURITY DEFINER function;
- deployed the typed `BootstrapRepository.resolveSession` method, which remains unused by live
  routes and session helpers;
- kept function execution restricted to the owner; and
- retained the current authentication and session paths.

This unit did not:

- grant execute to `PUBLIC` or the runtime application role;
- convert login, session, logout, 2FA, middleware, or any route;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- change web startup migration behavior or create the one-shot migrator job;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change malware scanning, P0-4, networking, firewall, private networking, or HA;
- access Brightside, customer rooms, documents, or content; or
- use production `deep=true` health.

## 2. PR CI rerun and human review

The authorized failed-jobs-only rerun targeted PR CI run `31556157351` on the exact source head
`837fae68095d73edb41dc9fe26023d1f3f973357`.

Attempt 2 completed successfully. The previously failing external-font and standalone-build path
passed, as did:

- E2E tests;
- the standalone browser build;
- password-reset browser coverage;
- regular build;
- Docker build;
- RLS integration;
- security scan;
- type-check, lint, formatting, and unit tests; and
- all other required PR checks.

Image publication skipped as expected for a pull request.

Human review of the exact eight-file diff found no blocking issue. The review confirmed:

- the migration fails closed on owner, role-reachability, table-privilege, function, and ACL drift;
- the function returns only the documented session, user, organization, and membership projection;
- the raw token, IP address, user agent, password hash, 2FA material, and unrelated data are not
  returned;
- unknown, inactive, unbound, idle-expired, absolute-expired, membership-revoked, and
  organization-inactive sessions resolve to no row;
- SQL is static, fully qualified, and protected by `search_path=pg_catalog`;
- the repository call is parameterized and fails closed on malformed or unexpected results;
- no runtime execute grant exists; and
- no route, session helper, deployment workflow, entrypoint, Azure resource, Key Vault reference,
  Prisma schema, W1-3 control, or P0-4 control changed.

## 3. Controlled merge and deployment

Before merge, workflow `251547585` was active and no real deployment was queued or in progress.
The stale risk-accepted ghost run `31428108038` remained non-actionable and was not treated as a
live deployment.

The workflow was disabled and verified as `disabled_manually`. PR #129 was marked ready and merged
with the exact-head guard. The resulting main tip was
`b9c2e0018d5e0727f8cfe515d2e335c46ecafe96`.

Exact-main CI run `31559902373` completed successfully on that SHA, including immutable web and
worker image publication. No deployment started while the workflow was disabled.

Before re-enable and dispatch:

- the main tip still matched the approved merge commit;
- the Munger subscription was verified as
  `041a67eb-fec8-41a4-9d70-c35863268cd6`;
- the existing worker rollback source was Healthy, Provisioned, and ScaledToZero; and
- no real deploy run was active or queued.

Workflow `251547585` was re-enabled and verified as `active`. Repeated checks found no side-effect
deployment. One workflow dispatch was then issued for the exact main SHA. Deployment run
`31560478351` succeeded. No second dispatch was issued.

The successful workflow applied the migration, deployed web and worker images, updated all three
scheduled jobs, passed password-reset reconciler preflight, passed quick health, and passed exact
post-cutover convergence. Recovery steps did not run.

## 4. Live workload identity and rollback posture

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `b9c2e0018d5e0727f8cfe515d2e335c46ecafe96` |
| Revision              | `ca-vaultspace-web--0000286`               |
| Degraded capabilities | none                                       |

The web workload converged to one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000286`;
- health: Healthy;
- provisioning: Provisioned;
- replicas: 1;
- traffic: 100 percent; and
- web runnable digest:
  `sha256:303070a04c9e416ef2c792382627106afa4ee32945a8601e2e1472fca418913a`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:94a9f75a874d18a93c45cbda8a8859ed45f7b2033acf0c679bd01ac25b32ded9`

| Workload                         | Result                                       |
| -------------------------------- | -------------------------------------------- |
| `ca-vaultspace-worker--0000269`  | Healthy, Provisioned, deployed worker digest |
| `ca-vaultspace-delayed-waker`    | Succeeded, Schedule, deployed worker digest  |
| `ca-vaultspace-invite-lifecycle` | Succeeded, Schedule, deployed worker digest  |
| `ca-vaultspace-pwreset-recon`    | Succeeded, Schedule, deployed worker digest  |

The prior Unit 1 rollback source remains retained:

- web revision: `ca-vaultspace-web--0000285`;
- active: false;
- health: Healthy;
- provisioning: Provisioned; and
- web runnable digest:
  `sha256:9f8311412506b7eb99a370123d0e8d99d76313e15ed749de451d46b48b7181b1`.

The prior worker revision `ca-vaultspace-worker--0000268` and its runnable digest
`sha256:f1bf457251bf58bdb048242c7d7101e68bb58f4a83f92e603625293099059a64`
also remain available. No revision or image was deleted.

Password-reset health retained HMAC write mode and configured recovery compatibility.

## 5. Production catalog verification

Catalog verification used a process-local connection obtained from the existing Munger Key Vault
reference. The secret value was not printed, persisted, placed in a command argument, or written to
a file. The query was restricted to PostgreSQL catalog and migration metadata. No customer row was
queried.

The migration record is finished and has not been rolled back:

`20260812020000_w1_2_session_bootstrap_foundation`

### 5.1 Owner posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- without members;
- not a member of another role; and
- unreachable directly or transitively by the runtime role.

Its exact table privileges are `SELECT` on:

- `organizations`;
- `sessions`;
- `user_organizations`; and
- `users`.

### 5.2 Function posture

The live function posture is exact:

- function count: one;
- signature: `input_token text`;
- result: the approved minimal session projection;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- configuration: `search_path=pg_catalog`;
- contract comment: `vaultspace-contract:w1-2-session-resolve-v1`;
- source SHA-256:
  `7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916`;
- execute ACL: owner only; and
- runtime execute: false.

This verifies that the new surface is deployed but remains inert and unavailable to the public web
runtime.

## 6. Bounded CloudVault acceptance smoke

The smoke used the retained synthetic verification organization:

| Field              | Value                    |
| ------------------ | ------------------------ |
| Organization name  | `CloudVault`             |
| Organization slug  | `cloudvault-w1-2-verify` |
| Organization state | active                   |

One dedicated synthetic VIEWER identity was created for this smoke:

`w12-unit2-session-d8b42b7d6967@example.test`

Its password was generated in process memory and was never printed or persisted. The login guard
required the response to return the exact CloudVault name and retained synthetic slug.

| Authorized check             | Result                                    |
| ---------------------------- | ----------------------------------------- |
| Login                        | PASS, HTTP 200, exact CloudVault identity |
| Authenticated `/api/auth/me` | PASS, HTTP 200                            |
| Logout                       | PASS, HTTP 200                            |
| Old session after logout     | PASS, HTTP 401                            |

No room, folder, document, link, preview, download, export, content, or Brightside endpoint was
called.

After the smoke:

- all sessions for the dedicated user were soft-disabled;
- the dedicated CloudVault membership was soft-disabled;
- the dedicated user was soft-disabled;
- active sessions, memberships, and users from the operation each counted zero; and
- immutable login and logout audit records were retained.

The empty active CloudVault organization remains available for later W1-2 verification phases.

## 7. Strawman, Steelman, and Pre-Mortem update

### Strawman

- An inert function could be treated as harmless without proving its live catalog ACL.
- A successful deployment could hide a mixed worker or scheduled-job image set.
- A generic login smoke could pass against the wrong organization and create invalid evidence.

### Steelman

- The unit advances the pre-tenant session boundary while keeping all production callers on the
  established path.
- Owner-only execution prevents the public runtime from using the function before route-conversion
  parity is reviewed.
- Exact catalog verification and exact-name CloudVault acceptance prove both the inert database
  posture and unchanged user-visible authentication behavior.

### Pre-Mortem

If the migration broadened the owner or exposed the function, the catalog check would show an
unexpected role, table privilege, or execute ACL. If workload deployment were incoherent, the
digest and revision checks would fail before acceptance. If the login smoke used the wrong target,
the exact name and slug guard would reject it. None of these conditions occurred.

Because no production caller uses the function, an unexpected later issue can be corrected through
a reviewed additive migration while execution remains withheld. The retained Unit 1 revision and
images remain the immediate application rollback source.

## 8. Status and next gate

**W1-2 Unit 2: DEPLOYED, CATALOG GREEN, CLOUDVAULT SMOKE GREEN, PENDING WRITTEN ADVISOR
CLOSE-OUT.**

**W1-2 overall: OPEN.**

The public web still has `DATABASE_URL_ADMIN`. Runtime execute remains withheld. Login, session,
logout, 2FA, and middleware route conversion has not started. The one-shot migrator and entrypoint
cutover have not started. W1-3 production enforcement remains blocked. The security freeze and
silent-hardening posture remain active. P0-4 remains accepted and unchanged.

No subsequent W1-2 implementation unit is implied or started by this evidence. A later unit must
remain separately analysis-first and must preserve the binding rule that `DATABASE_URL_ADMIN`
cannot be removed before the complete CloudVault authentication matrix is green on replacement
paths.

## References

- PR #129
- PR CI run `31556157351`, attempt 2
- Main CI run `31559902373`
- Deployment run `31560478351`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_VALIDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812020000_w1_2_session_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `tests/integration/bootstrap-session-resolve.test.ts`
