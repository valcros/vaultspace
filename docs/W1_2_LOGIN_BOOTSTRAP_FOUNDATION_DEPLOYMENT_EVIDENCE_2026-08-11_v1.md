# W1-2 Login Bootstrap Foundation Deployment Evidence

- **Date:** 2026-08-11 America/Los_Angeles
- **Control family:** W1-2 database privilege split, additive login bootstrap foundation
- **Source PR:** #127
- **Source head:** `5a7b1c78061b5facd1485de85388a74038c24e3a`
- **Merge commit and deployed release:** `3701e36fb0fbe3b29b2d7188fac1ebcfbed9f75e`
- **Main CI:** `31548712343`, success
- **Deployment:** `31549294746`, success
- **Result:** Deployment and catalog posture green. CloudVault identity acceptance blocked.
- **W1-2 status:** OPEN. The foundation is live but the unit is not acceptance-closed.
- **Freeze status:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This deployment applied the additive, inert foundation approved by the Stakeholder Advisor. It:

- created the NOLOGIN, NOBYPASSRLS `vaultspace_bootstrap_owner` role;
- created the versioned `bootstrap_login_candidate_v1(text)` SECURITY DEFINER function;
- installed the three restrictive active-row policies;
- deployed the typed `BootstrapRepository`, which remains unused by production routes; and
- retained the existing public-web authentication path and `DATABASE_URL_ADMIN` configuration.

This unit did not:

- grant function execute to the runtime application role;
- convert login, 2FA, session, domain, registration, or password-reset routes;
- remove `DATABASE_URL_ADMIN`;
- change web startup migration behavior;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change malware scanning, networking, firewall, HA, or customer-facing behavior;
- query Brightside data; or
- use production `deep=true` health.

## 2. Controlled merge and deployment

Human review found no blocking issue in the exact-head PR diff. The package change added only the
new PostgreSQL contract test to the existing RLS integration command. No application route imports
or calls the new repository.

The deployment workflow was disabled before merge. PR #127 was marked ready and merged with an
exact-head guard. The resulting main SHA was
`3701e36fb0fbe3b29b2d7188fac1ebcfbed9f75e`.

Exact-main CI run `31548712343` completed successfully, including:

- type-check;
- lint and formatting;
- unit tests;
- RLS integration;
- provider event inbox integration;
- security scan;
- Azure and standalone deployment-mode tests;
- E2E, standalone browser build, and password-reset browser coverage;
- application build; and
- immutable web and worker image publication.

No deployment started while workflow `251547585` was disabled. Before re-enabling, the Munger
subscription guard confirmed subscription `041a67eb-fec8-41a4-9d70-c35863268cd6`. The current
worker rollback source was stable:

- revision `ca-vaultspace-worker--0000267`;
- Healthy and Provisioned;
- single-revision mode;
- ScaledToZero;
- runnable digest
  `sha256:afe783f5d3c648cd1effcbc18af24811f5b42decf26dd01e4a9bc20c5b1c8499`.

The workflow was re-enabled without a side-effect run. One manual dispatch was issued for the exact
main tip. Deployment run `31549294746` succeeded. No second dispatch was issued.

The earlier before-state footgun did not recur. Capture of the stable rollback source passed before
the pipeline ran migrations or mutated workloads.

## 3. Live workload identity

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                              | Result                                     |
| ---------------------------------- | ------------------------------------------ |
| Status                             | healthy                                    |
| Mode                               | azure                                      |
| Release                            | `3701e36fb0fbe3b29b2d7188fac1ebcfbed9f75e` |
| Revision                           | `ca-vaultspace-web--0000285`               |
| Degraded capabilities              | none                                       |
| Password-reset token write mode    | hmac                                       |
| Password-reset recovery configured | true                                       |

The web workload converged to one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000285`;
- health: Healthy;
- provisioning: Provisioned;
- replicas: 1;
- traffic: 100 percent;
- web runnable digest:
  `sha256:9f8311412506b7eb99a370123d0e8d99d76313e15ed749de451d46b48b7181b1`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:f1bf457251bf58bdb048242c7d7101e68bb58f4a83f92e603625293099059a64`

| Workload                         | Result                                      |
| -------------------------------- | ------------------------------------------- |
| `ca-vaultspace-worker--0000268`  | Succeeded, deployed worker digest           |
| `ca-vaultspace-delayed-waker`    | Succeeded, Schedule, deployed worker digest |
| `ca-vaultspace-invite-lifecycle` | Succeeded, Schedule, deployed worker digest |
| `ca-vaultspace-pwreset-recon`    | Succeeded, Schedule, deployed worker digest |

Rollback revisions remain retained and provisioned:

| Revision                     | Active | Health  | Runnable digest                                                           |
| ---------------------------- | ------ | ------- | ------------------------------------------------------------------------- |
| `ca-vaultspace-web--0000283` | false  | Healthy | `sha256:3f1eab46892bd17e3d72f0165a97ab14ab0afa5121e6a7f5a8dede0cbf4603d2` |
| `ca-vaultspace-web--0000284` | false  | Healthy | `sha256:2e7d5d4748b9c70c5b10d4f5f6dd13af9f8540d90c5134962ed6e567e5000c6f` |
| `ca-vaultspace-web--0000285` | true   | Healthy | `sha256:9f8311412506b7eb99a370123d0e8d99d76313e15ed749de451d46b48b7181b1` |

No revision or image was deleted.

## 4. Production catalog verification

Catalog verification used a process-local connection obtained from the existing Munger Key Vault
reference. The secret value was not printed, persisted, placed in a command argument, or written to
a file. No customer row was queried.

The migration record is finished and has not been rolled back:

`20260811231000_w1_2_login_bootstrap_foundation`

The live role posture is exact:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- no members; and
- not a member of another role.

The live function posture is exact:

- signature: `input_email text`;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- function search path: `pg_catalog`;
- contract comment: `vaultspace-contract:w1-2-login-candidate-v1`; and
- execute ACL: owner only, with no PUBLIC or runtime application grant.

All three expected active-row policies exist as RESTRICTIVE SELECT policies for the owner role on:

- `users`;
- `user_organizations`; and
- `organizations`.

## 5. CloudVault acceptance blocker

The required minimal acceptance was login, authenticated session, logout, and rejection of the old
session. No room or document access was planned.

The first approved Key Vault QA credential authenticated successfully through the unchanged login
path, but the returned organization was not CloudVault. The run rejected that identity before
claiming a CloudVault smoke pass. The one session created by that rejected attempt was subsequently
soft-disabled using the unique test user-agent predicate. Immutable audit evidence was not deleted.

The previously committed W1-1 acceptance runner showed that CloudVault verification used a
synthetic identity created inside an existing active organization whose exact name was CloudVault.
A guarded attempt to reproduce that method checked organization identity before creating any user.
The guard found:

- exact CloudVault name matches: 0;
- active exact CloudVault name matches: 0;
- CloudVault-like slug matches: 0;
- QA smoke account mapped to CloudVault: false; and
- QA worker account mapped to CloudVault: false.

Because the expected test organization is absent from the live database, no synthetic CloudVault
identity was created and the target login, session, and logout acceptance could not run. No room,
document, preview, download, export, or Brightside data was accessed.

This is an environment identity blocker, not evidence of a login-route regression. The unchanged
login route returned HTTP 200 for the approved QA credential, live health is green, the migration is
complete, and the catalog posture is exact. The unit nevertheless remains acceptance-open because a
successful login to a different test organization cannot substitute for the required CloudVault
check.

## 6. Strawman, Steelman, and Pre-Mortem update

### Strawman

- Treating catalog green as sufficient would ignore the required end-to-end CloudVault identity
  check.
- Recreating or renaming an organization merely to obtain a pass would destroy continuity with the
  W1-1 acceptance target.
- Rolling back an additive inert migration because the test organization is absent could re-expose
  production to an unnecessary deployment transition without resolving the verification blocker.

### Steelman

- The deployed role and function have the exact least-privilege posture intended for the first
  W1-2 unit.
- Existing login behavior remains operational, and no runtime route can call the new function.
- Refusing to substitute a different organization preserves the integrity of the acceptance gate.

### Pre-Mortem

If the next unit began now, the team could cite a non-CloudVault login as proof and later discover
that the intended test organization or account mapping had drifted. The control is to hold route
conversion until the Advisor identifies or restores the authoritative CloudVault organization and
the minimal target smoke passes.

Rollback remains available through retained revisions `0000283` and `0000284`. No rollback was
performed because the deploy, live health, existing login path, workload coherence, migration, and
catalog posture are green, while the blocker is the absence of the named verification target.

## 7. Status and next gate

**W1-2 foundation: DEPLOYED, CATALOG GREEN, CLOUDVAULT ACCEPTANCE BLOCKED.**

**W1-2 overall: OPEN.**

The next W1-2 implementation unit must not start until the Stakeholder Advisor resolves which live
organization is the authoritative CloudVault target, or authorizes creation of a replacement
CloudVault synthetic organization, and the minimal login, session, logout, and post-logout 401
smoke passes.

`DATABASE_URL_ADMIN` remains present in the web workload. Runtime execute remains withheld. Route
conversion has not started. W1-3 production enforcement remains blocked. The security freeze and
silent-hardening rules remain active. P0-4 remains accepted and unchanged.

## References

- PR #127
- Main CI run `31548712343`
- Deployment run `31549294746`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_VALIDATION_2026-08-11_v1.md`
- `scripts/cloudvault-w1-1-acceptance-v1.cjs`
