# W1-2 Login Bootstrap Foundation Deployment Evidence

- **Date:** 2026-08-11 America/Los_Angeles
- **Control family:** W1-2 database privilege split, additive login bootstrap foundation
- **Source PR:** #127
- **Source head:** `5a7b1c78061b5facd1485de85388a74038c24e3a`
- **Merge commit and deployed release:** `3701e36fb0fbe3b29b2d7188fac1ebcfbed9f75e`
- **Main CI:** `31548712343`, success
- **Deployment:** `31549294746`, success
- **Result:** Deployment, catalog posture, and CloudVault acceptance green.
- **W1-2 Unit 1 status:** Acceptance criteria met, pending written Advisor close-out.
- **W1-2 overall status:** OPEN.
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

## 5. CloudVault fixture restoration and acceptance

The required minimal acceptance was login, authenticated session, logout, and rejection of the old
session. No room or document access was planned or performed.

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

This established fixture drift rather than a login-route regression. The unchanged login route
returned HTTP 200 for the approved QA credential, live health remained green, the migration was
complete, and the catalog posture was exact. A successful login to a different test organization
was not used as a substitute for the required CloudVault check.

### 5.1 Advisor fixture GO

The Stakeholder Advisor accepted the stop and authorized creation of one replacement synthetic
active organization whose exact display name is CloudVault. The authorization required a dedicated
synthetic login user, no existing organization rename, no Brightside use, no customer enumeration,
no room or document matrix, no deployment, no route conversion, and no admin URL removal.

### 5.2 Replacement verification target

The guarded fixture operation rechecked that no exact-name organization existed before creating the
replacement. It then created:

| Field                | Value                                                |
| -------------------- | ---------------------------------------------------- |
| Organization name    | `CloudVault`                                         |
| Organization id      | `cmspcz1om0000q03r3vuiti5e`                          |
| Organization slug    | `cloudvault-w1-2-verify`                             |
| Organization status  | active                                               |
| Synthetic role       | VIEWER                                               |
| Synthetic user label | `w12-unit1-cloudvault-c3cc7015af574208@example.test` |

The synthetic password was generated in process memory, was never printed or persisted, and was
cleared after login.

### 5.3 Minimal acceptance results

The login guard required the response to identify an active organization whose exact name was
CloudVault and whose slug was `cloudvault-w1-2-verify`.

| Check                                        | Result                         |
| -------------------------------------------- | ------------------------------ |
| Exact-name active fixture creation           | PASS                           |
| Dedicated synthetic membership creation      | PASS                           |
| Login through the unchanged production route | PASS, HTTP 200                 |
| Returned organization exact name             | PASS, `CloudVault`             |
| Returned organization slug                   | PASS, `cloudvault-w1-2-verify` |
| Authenticated `/api/auth/me` session         | PASS, HTTP 200                 |
| Authenticated logout                         | PASS, HTTP 200                 |
| Old session after logout                     | PASS, HTTP 401                 |

No room, folder, document, preview, download, export, or content endpoint was called.

### 5.4 Cleanup and retained fixture posture

After the smoke, the dedicated synthetic user, its CloudVault membership, and all of its sessions
were soft-disabled. The authenticated login and logout audit evidence was retained.

The replacement CloudVault organization remains active for later W1-2 authentication phases. Its
post-smoke posture is:

- exact name: CloudVault;
- slug: `cloudvault-w1-2-verify`;
- active synthetic users: 0 from this operation;
- active synthetic memberships: 0 from this operation;
- active synthetic sessions: 0 from this operation;
- rooms: 0; and
- documents: 0.

No existing organization or shared QA membership was renamed or rewritten. No new deployment was
performed for the smoke.

## 6. Strawman, Steelman, and Pre-Mortem update

### Strawman

- Treating catalog green as sufficient would have ignored the required end-to-end CloudVault
  identity check.
- Reusing the QA account's unrelated organization would have produced a false acceptance result.
- Retaining a replacement fixture could become ambiguous if it were not labeled, empty, and
  recorded for synthetic-only W1-2 verification.

### Steelman

- The deployed role and function have the exact least-privilege posture intended for the first
  W1-2 unit.
- Existing login behavior remains operational, and no runtime route can call the new function.
- The dedicated exact-name fixture preserves the integrity and repeatability of the acceptance
  gate without touching another organization.

### Pre-Mortem

If the fixture creation or login guard had used the wrong organization, Unit 1 could have been
closed on invalid evidence. The controls were an exact-name and exact-slug response check, a
dedicated synthetic identity, no shared membership rewrite, categorical smoke results, and
post-smoke soft-disable verification.

Rollback remains available through retained revisions `0000283` and `0000284`. No rollback was
performed because the deploy, live health, existing login path, workload coherence, migration,
catalog posture, and restored CloudVault acceptance are green.

## 7. Status and next gate

**W1-2 foundation: DEPLOYED, CATALOG GREEN, CLOUDVAULT ACCEPTANCE GREEN, PENDING WRITTEN ADVISOR
CLOSE-OUT.**

**W1-2 overall: OPEN.**

The Unit 1 technical acceptance criteria are met. The next W1-2 implementation unit must not start
until the Stakeholder Advisor reviews this evidence and issues the written Unit 1 close-out stamp.

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
