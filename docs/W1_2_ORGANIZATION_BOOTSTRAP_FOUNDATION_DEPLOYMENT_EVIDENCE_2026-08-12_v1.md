# W1-2 Organization Bootstrap Foundation Deployment Evidence

- **Date:** 2026-08-12
- **Execution time:** 2026-08-11 America/Los_Angeles
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Additive organization-resolve foundation
- **Source PR:** #131
- **Source head:** `d2cf0bb26605a015663b6e3f726f085afb4cf371`
- **Merge commit and deployed release:** `0b80bce399c76f6ac2cfd4b575c89f5c04efcf63`
- **PR CI:** `31564009847`, success on the exact source head
- **Main CI:** `31565031345`, success
- **Deployment:** `31565530408`, success
- **Result:** Deployment, live catalog posture, workload coherence, and bounded CloudVault smoke green
- **W1-2 Unit 3 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit deployed the additive organization bootstrap foundation approved by the Stakeholder
Advisor. It:

- created `public.bootstrap_organization_resolve_v1(text, text)` as one exact SECURITY DEFINER
  function;
- used the existing constrained `vaultspace_bootstrap_owner` without adding owner table
  privileges;
- deployed typed `BootstrapRepository.resolveOrganizationBySlug` and
  `BootstrapRepository.resolveOrganizationByCustomDomain` methods that remain unused by live
  routes;
- kept function execution restricted to the owner; and
- retained all established authentication, organization-resolution, public-branding, and
  middleware paths.

This unit did not:

- grant execute to `PUBLIC` or `vaultspace_app`;
- convert login, session, logout, middleware, public-branding, forgot-password, or any other route;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- change the web entrypoint, migration execution model, or Azure resource definitions;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change malware scanning, P0-4, networking, firewall, private networking, HA, or geo posture;
- access Brightside, customer rooms, documents, or content; or
- use production `deep=true` health.

## 2. Human review and controlled merge

Human review covered the exact seven-file PR #131 diff at source head
`d2cf0bb26605a015663b6e3f726f085afb4cf371`. The review confirmed:

- the migration fails closed on owner posture, runtime role reachability, existing table
  privileges, schema privileges, function posture, and execute ACL drift;
- the function accepts only the reviewed slug and custom-domain lookup kinds and returns the
  approved minimal organization and branding projection;
- SQL is static, fully qualified, parameterized, and protected by `search_path=pg_catalog`;
- the owner remains NOLOGIN, NOBYPASSRLS, and unreachable from the runtime role;
- `PUBLIC` and runtime execute remain revoked;
- the repository methods validate and normalize inputs and fail closed on malformed or
  unexpected results;
- no live route imports or calls the new repository methods; and
- the PR contains no workflow, entrypoint, Azure, Key Vault, Prisma schema, W1-3, or P0-4 change.

All PR checks were green on the exact source head before merge.

Before merge, workflow `251547585` was active and no real deployment was queued or in progress.
The workflow was disabled and verified as `disabled_manually`. The previously risk-accepted stale
run `31428108038` remained non-actionable and was not treated as an active deployment.

PR #131 was marked ready and merged with an exact-head guard. The resulting main tip was
`0b80bce399c76f6ac2cfd4b575c89f5c04efcf63`.

## 3. Exact-main CI and single deployment

Exact-main CI run `31565031345` completed successfully on the merge commit. The successful run
included:

- unit tests, lint, formatting, and type-check;
- provider event inbox tests;
- standalone and Azure deployment-mode checks;
- RLS integration, including all three W1-2 foundation suites;
- E2E tests and the standalone password-reset browser path;
- the regular application build; and
- immutable web and worker image publication.

No deployment started while workflow `251547585` was disabled. The optional Unit 2 docs-only main
CI rerun for run `31562877978` was not used because the Advisor made it non-blocking for Unit 3.

After exact-main CI was green:

- main still equaled the approved merge commit;
- no real deploy run was active or queued;
- the deploy workflow was re-enabled and verified as `active`;
- enablement did not start a deployment; and
- exactly one workflow dispatch was issued for the exact main SHA.

Deploy run `31565530408` succeeded. No second dispatch was issued. The workflow applied the
migration, deployed web and worker images, updated all three scheduled jobs, passed the
password-reset compatibility contract and reconciler preflight, passed quick health, and passed
strict post-cutover convergence. Recovery steps did not run.

## 4. Live identity and workload coherence

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `0b80bce399c76f6ac2cfd4b575c89f5c04efcf63` |
| Revision              | `ca-vaultspace-web--0000287`               |
| Degraded capabilities | none                                       |

The web workload converged to one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000287`;
- health: Healthy;
- provisioning: Provisioned;
- replicas: 1;
- traffic: 100 percent; and
- web runnable digest:
  `sha256:a4b2adf6ccdfb5e16f257c00c8d22ca11491471b35445e7354d98cbd28833c24`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:1c0070a13be979e9dafe1c60e098377210e9596e555cbbf90e65d9d9b0ab4f74`

| Workload                         | Result                           |
| -------------------------------- | -------------------------------- |
| `ca-vaultspace-worker--0000270`  | Healthy, deployed worker digest  |
| `ca-vaultspace-delayed-waker`    | Schedule, deployed worker digest |
| `ca-vaultspace-invite-lifecycle` | Schedule, deployed worker digest |
| `ca-vaultspace-pwreset-recon`    | Schedule, deployed worker digest |

The prior Unit 2 rollback source remains retained:

- web revision: `ca-vaultspace-web--0000286`;
- prior web runnable digest:
  `sha256:303070a04c9e416ef2c792382627106afa4ee32945a8601e2e1472fca418913a`;
- worker revision: `ca-vaultspace-worker--0000269`; and
- prior worker runnable digest:
  `sha256:94a9f75a874d18a93c45cbda8a8859ed45f7b2033acf0c679bd01ac25b32ded9`.

No revision or image was deleted. The deploy workflow remains active.

## 5. Production catalog verification

Catalog verification used a process-local connection obtained from the existing Munger Key Vault
reference. The secret value was not printed, persisted, placed in a command argument, or written to
a file. The query was restricted to PostgreSQL catalog and migration metadata. No customer row was
queried.

Migration `20260812050000_w1_2_organization_bootstrap_foundation` is finished and has not been
rolled back.

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
- unreachable directly or transitively by `vaultspace_app`.

The owner has schema `USAGE`, not schema `CREATE`, and its exact table privileges are `SELECT` on:

- `organizations`;
- `sessions`;
- `user_organizations`; and
- `users`.

### 5.2 Function posture

The live function posture is exact:

- function count: one;
- signature: `public.bootstrap_organization_resolve_v1(text, text)`;
- identity arguments: `input_lookup_kind text, input_lookup_value text`;
- result: the approved minimal organization and branding projection;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- configuration: `search_path=pg_catalog`;
- contract comment: `vaultspace-contract:w1-2-organization-resolve-v1`;
- stored source SHA-256:
  `27cc50a7040e357fc49cb9a838432df9b0a5b9845aa49640acf2a71d4bc14df7`;
- execute ACL: owner only; and
- `vaultspace_app` execute: false.

This proves the organization-resolve surface is deployed but remains inert and unavailable to the
public web runtime.

## 6. Bounded CloudVault acceptance smoke

The smoke used the retained empty synthetic verification organization:

| Field              | Value                    |
| ------------------ | ------------------------ |
| Organization name  | `CloudVault`             |
| Organization slug  | `cloudvault-w1-2-verify` |
| Organization state | active                   |

One dedicated synthetic VIEWER identity was created for the smoke:

`w12-unit3-org-13301500d416@example.test`

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
- the retained CloudVault organization remained active for later W1-2 verification.

## 7. Authorized local cleanup

Before the controlled merge, the following three exited disposable PostgreSQL containers were
verified as exited with code 0 and removed exactly as authorized:

- `vaultspace-w1-2-org-foundation-v1`;
- `vaultspace-w1-2-org-foundation-v2`; and
- `vaultspace-w1-2-org-foundation-azure-v1`.

Only disposable local container metadata and writable layers were removed. Container images,
Azure resources, the production database, and all other local containers were untouched.

## 8. Strawman, Steelman, and Pre-Mortem update

### Strawman

- An inert organization resolver could be assumed safe without checking its live owner and ACL.
- Re-enabling deployment could create an unnoticed second run.
- A generic login smoke could pass against a different organization and create invalid evidence.

### Steelman

- The unit adds a minimal pre-tenant organization lookup while all production callers remain on
  the established path.
- Owner-only execution keeps the new function unreachable from the public runtime until a later
  route-conversion unit is separately reviewed.
- Exact-main CI, immutable images, strict workload convergence, catalog verification, and an
  exact-name CloudVault smoke collectively prove both the inert database posture and unchanged
  authentication behavior.

### Pre-Mortem

If the migration broadened the owner or exposed the function, the catalog check would show an
unexpected role, privilege, or execute ACL. If workload deployment were mixed or incomplete, the
digest, sole-active revision, traffic, or health checks would fail. If the smoke selected the wrong
organization, the exact name and slug guard would reject it. None of these conditions occurred.

Because no production route calls the function, a later defect can be corrected through a reviewed
additive migration while runtime execution remains withheld. The retained Unit 2 revision and
images remain the immediate application rollback source.

## 9. Status and next gate

**W1-2 Unit 3: DEPLOYED, CATALOG GREEN, CLOUDVAULT SMOKE GREEN, PENDING WRITTEN ADVISOR
CLOSE-OUT.**

**W1-2 overall: OPEN.**

The public web still has `DATABASE_URL_ADMIN`. Runtime execute remains withheld. Login, session,
logout, 2FA, middleware, public-branding, and forgot-password route conversion has not started. The
one-shot migrator and entrypoint cutover have not started. W1-3 production enforcement remains
blocked. The security freeze and silent-hardening posture remain active. P0-4 remains accepted and
unchanged.

No later W1-2 implementation unit is implied or started by this evidence. Runtime execute grants,
route conversion, admin URL removal, and W1-3 enforcement require their later gates.

## References

- PR #131: https://github.com/valcros/vaultspace/pull/131
- PR CI run `31564009847`: https://github.com/valcros/vaultspace/actions/runs/31564009847
- Main CI run `31565031345`: https://github.com/valcros/vaultspace/actions/runs/31565031345
- Deploy run `31565530408`: https://github.com/valcros/vaultspace/actions/runs/31565530408
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_VALIDATION_2026-08-12_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `prisma/migrations/20260812050000_w1_2_organization_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/bootstrapRepository.test.ts`
- `tests/integration/bootstrap-organization-resolve.test.ts`
