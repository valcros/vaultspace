# VaultSpace Wave 0 Deployment Evidence

Date: 2026-08-10 Pacific time

Evidence version: 1

Release status: Deployed and verified

W0-1 status: **CLOSED**

W0-2 status: **CLOSED**

Security freeze status: **ACTIVE**

## Decision summary

Close W0-1 for release `69717769976d209687812b0301922cdce0f642f8`.

The approved dependency baseline, already-reviewed security-relevant main changes, and bounded
deployment-control corrections are live on the production host. Exact-main CI and the guarded
pipeline completed successfully. Quick uncached identity health, CloudVault functional smoke, and
the authorized minimal Brightside smoke are green.

This closure applies only to Wave 0. It does not close the security freeze or claim that
authorization, database privilege separation, or RLS completeness is fixed. P0-4 fail-open
malware-scan behavior remains an explicitly accepted residual risk and is unchanged.

## Scope and operating boundaries

The release and verification stayed inside these boundaries:

- Azure activity was limited to the Munger subscription and the existing VaultSpace staging
  resource group. The Medau subscription was not queried or changed.
- Production smoke used only `vaultspace.org` and did not use `vaultspace.cloud`.
- Production health checks used quick, uncached identity health only. No `deep=true` probe ran.
- CloudVault, not the earlier mistaken CloudSpace name, was the test organization used for
  functional verification.
- Brightside was limited to an authenticated shell check, its known single-room path, and logout.
- No Brightside customer row, room-list scrape, document metadata, preview, download, export, or
  content was read or recorded.
- No Key Vault secret value, credential, token, document detail, or customer data is present in
  this record.
- No feature, authorization, RLS, malware-scan, firewall, private-networking, HA, CSP, HSTS, or
  customer-communication change was included.

## Closure analysis

### Strawman

- A green dependency audit does not prove that application authorization, RLS, or runtime database
  privilege is safe.
- A shell and single-room-path smoke is intentionally shallow. It can detect routing and session
  breakage but cannot prove every Brightside workflow.
- Nine small release and deployment-control PRs increase review surface compared with one
  dependency PR, even though each correction remained within one control family.
- A healthy public endpoint can hide a worker, scheduled-job, or rollback defect if Azure state and
  immutable image identity are not checked independently.
- Closing W0-1 could be misread as permission to resume feature work or to start unapproved W1
  implementation.

### Steelman

- The previously live public web process contained known high-severity dependency advisories. The
  final release contains the approved patched dependency tree and already-reviewed transactional
  email HTML escaping.
- Exact-main CI built and published immutable images for the release that the deployment workflow
  used. The served health identity matches that release exactly.
- The real password-reset reconciler, not the web-owned advisory flag, was validated and executed as
  the steady-state HMAC authority before web cutover.
- The final pipeline retained strict first-activation, downgrade, immutable-artifact, worker
  readiness, Azure readiness, traffic-convergence, and rollback checks.
- CloudVault exercised login, session, the exact synthetic room, a bounded preview, logout, and
  session invalidation before Brightside was used for the minimal production smoke.
- The Brightside checks proved that the final release did not redirect the authenticated shell to
  login, did not break the known room path, and successfully terminated the session.

### Pre-Mortem

Assume closing W0-1 was followed by an incident.

1. The wrong image is serving despite a successful workflow.
   - Detection: compare exact release SHA, web revision, runnable image digest, ACR index digest,
     one-revision traffic convergence, and quick uncached health identity.
   - Rollback: restore the retained prior web image and revision through the existing pipeline
     recovery contract, then repeat the same identity checks.
2. Login or room routing breaks after the cutover.
   - Detection: CloudVault login and room smoke first, followed by the minimal Brightside shell and
     known-room-path smoke within the five-minute operational decision window.
   - Rollback: restore the retained prior web release. Do not diagnose by querying Brightside rows or
     document data.
3. Worker or scheduled-job state is silently inconsistent with web.
   - Detection: require the exact immutable worker digest on the worker and all three existing jobs,
     validate the job command and schedule, execute the real reconciler preflight, and require Azure
     provisioning/readiness.
   - Rollback: restore captured job images and the prior worker image when the compatibility policy
     requires it. Keep customer-facing web on the last healthy revision.
4. A cached health response creates false confidence.
   - Detection: use a unique identity query and `Cache-Control: no-cache` plus `Pragma: no-cache`,
     then require exact release and revision values.
   - Rollback: treat any mismatch as failed verification even when the HTTP status is 200.
5. Evidence collection exposes private Brightside information.
   - Detection: record only pass or fail, host class, release identity, and route class. Do not retain
     room identifiers, names, document metadata, screenshots, previews, or content.
   - Rollback: stop collection immediately and escalate any actual exposure. No such exposure was
     observed during this work.
6. Wave 0 closure creates false confidence about the broader freeze.
   - Detection: keep W1-1, W1-2, and W1-3 explicitly open in this record and retain P0-4 as accepted,
     not fixed.
   - Rollback: not applicable. The control is an explicit scope statement and Advisor approval gate.

### Go/no-go

**GO to close W0-1.** The Steelman justifies shipping the dependency baseline, the final release is
identifiable and healthy, both authorized smoke paths are green, and rollback artifacts remain
available. This is not a go decision for W1 implementation or freeze lift.

## Dependency and release baseline

PR #110 merged the approved W0-1 dependency baseline. The final deployed candidate also includes
the reviewed security-relevant main delta that had not been present in the prior live release,
including transactional email HTML escaping.

Recorded dependency movement includes:

- Next.js 16.2.9 to 16.2.12;
- nested Sharp 0.34.5 to deduplicated Sharp 0.35.3;
- libvips to 8.18.3;
- PostCSS 8.5.16 to 8.5.26;
- DOMPurify 3.4.11 to 3.4.13;
- Fast XML Parser 5.9.3 to 5.10.1;
- Linkify-it 5.0.1 to 5.0.2;
- compatible patched constraints for Brace Expansion and JS-YAML.

Validation recorded before release:

- clean `npm ci`: passed;
- production dependency audit: 0 vulnerabilities;
- complete dependency audit: 0 vulnerabilities;
- type-check: passed;
- lint: 0 errors and one pre-existing React hook warning;
- final unit suite: 1,216 passed;
- existing integration exclusions: 7 skipped;
- focused deployment regression suite: 60 of 60 passed;
- formatting, Node syntax, and diff checks: passed;
- exact-main CI run `31450263497`: passed and published immutable images.

## Analysis-first deployment corrections

Every bounded correction was documented before implementation with a Strawman, Steelman,
Pre-Mortem, rollback, and go/no-go decision.

| PR   | Merged commit                              | Control boundary                                                |
| ---- | ------------------------------------------ | --------------------------------------------------------------- |
| #110 | `abe29d07a14a6a49a9e64ee971738af111327fe6` | Approved dependency baseline and freeze record                  |
| #112 | `f3fed2c96c85a7bf006f148de7f2fe4b9ae714f6` | Scale-to-zero-aware worker deployment gates                     |
| #113 | `ef969c85f9bc773a600023fe9d54696e3e62b9f8` | Real reconciler authority and quick-health-only deploy contract |
| #114 | `a9832aad726efe44b9504cbc86c9627518eb8fa3` | Reconciler and constrained-worker topology alignment            |
| #115 | `d4f58a56f5272f0667d360f2eeca74bcb29d8b91` | Complete-template reconciler preflight execution                |
| #116 | `f30f303f2a98f72cdaaa449d3829aeeb7cccc31a` | Reconciler preflight command and arguments                      |
| #117 | `980b37b4067c2974dc152df7dc8c2389aabd0910` | Idempotent single-revision web cutover and recovery             |
| #118 | `6d742116cf5c7f8390279e550b0083d9bd40764f` | Digest-pinned worker image validation                           |
| #119 | `69717769976d209687812b0301922cdce0f642f8` | HMAC steady-state rollback artifact contract                    |

The real reconciler schedule remains `*/15 * * * *` with a 600-second timeout, as explicitly
accepted for Wave 0. The scheduled command remains `npm run worker:password-reset-reconcile`.
First-activation and downgrade guards remain strict. The web health field
`reconcilerEnabled: false` remains an advisory topology mismatch and was not treated as the
steady-state authority.

## Guarded deployment chronology

The release did not bypass a failed gate. Each deterministic failure stopped at its designed
boundary, left or restored the known-good public release, and led to an analysis-first correction.

| Run           | Result and bounded finding                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `31428365513` | Stopped before migrations because the worker readiness predicate rejected the healthy `ScaledToZero` state.                                                   |
| `31430650089` | Stopped before web mutation because the web-owned reconciler flag was incorrectly treated as authoritative for the existing real job.                         |
| `31434146692` | Stopped before web mutation because the reconciler database identity was incorrectly required to match both web and constrained worker topology.              |
| `31437081774` | Stopped before web mutation because an argument-only Azure job override omitted the required full execution template.                                         |
| `31439416195` | Stopped before web mutation because the full-template preflight duplicated the `npm` executable in its arguments.                                             |
| `31442259833` | The real preflight passed; cutover stopped on non-idempotent revision activation, and recovery exposed an invalid single-mode traffic command.                |
| `31446369589` | Web cutover completed; the environment validator misparsed an accepted digest-pinned worker reference, and automatic recovery restored the prior web release. |
| `31449202267` | Stopped before migrations and all workload mutation because the rollback guard rejected a valid mixed-source, immutable HMAC steady state.                    |
| `31450725042` | Passed every deployment gate for exact release `69717769976d209687812b0301922cdce0f642f8`; automatic recovery was correctly skipped.                          |

The initial worker template normalization attempt used the wrong container name and created an
unintended fourth-container revision. The next bounded correction rebuilt the worker from the full
three-container template. Revisions `0000259` and `0000260` were retained inactive rather than
deleted, and clean revision `0000261` restored the expected template shape before the guarded
release continued. The background-worker handoff completed within minutes, public web traffic was
not affected, and no file or revision record was deleted.

## Final pipeline evidence

- Final release SHA: `69717769976d209687812b0301922cdce0f642f8`.
- Exact-main CI: run `31450263497`, success.
- Deployment: run `31450725042`, success.
- Deployment interval: 2026-08-10 18:54 to 19:01 Pacific time.
- Traffic-affecting web mutation through health convergence: approximately 1 minute 37 seconds,
  within the five-minute unannounced-impact decision budget.
- Migrations: completed in the existing pipeline step before Container App mutation.
- Password-reset delivery-contract boundary: passed.
- Real reconciler static validation: passed.
- Real reconciler preflight execution: passed.
- Azure web readiness and convergence: passed.
- Final worker readiness: passed in healthy scale-to-zero state.
- Automatic recovery: skipped because the forward deployment succeeded.
- Deployment workflow ID `251547585`: returned to `disabled_manually` after the bounded dispatch.
- No customer-facing outage, 5xx response, blank shell, or unexpected login redirect was observed.

## Final Azure artifact and revision evidence

### Web

- Revision: `ca-vaultspace-web--0000277`.
- State: active, healthy, provisioned, running with one replica.
- Traffic: 100 percent.
- Runnable platform digest:
  `sha256:3f1eab46892bd17e3d72f0165a97ab14ab0afa5121e6a7f5a8dede0cbf4603d2`.
- ACR release index digest:
  `sha256:28f5e1234ed6848fc640499c2ed561af2a890d36cc3c01311a23d6151283d5b9`.

### Worker and existing jobs

- Worker revision: `ca-vaultspace-worker--0000263`.
- Worker state: active, healthy, provisioned, `ScaledToZero`, zero replicas, expected three-container
  template.
- Runnable platform digest:
  `sha256:7c66163152c4a5073d3e1895c5a96c3d19523265a7bca5248a293af2ef7d22b3`.
- ACR release index digest:
  `sha256:bb580d353a3878260bbbb90f088c58d15fbdf7ba1c33f44d8b7df5721f359a0e`.
- Delayed waker, invitation lifecycle, and password-reset reconciler use the same final runnable
  worker digest and report successful provisioning.
- A scheduled reconciler execution after deployment succeeded.

The runnable digest and ACR index digest are intentionally recorded separately. The release tag is
an image index, while the Container Apps runtime resolves a platform-specific manifest.

The previous web and worker revision records and their immutable images remain available for
pipeline rollback. They were not deleted before smoke verification completed.

## Quick production health evidence

The final recheck used only the quick endpoint with a unique identity query and explicit no-cache
headers.

- Host: `vaultspace.org`.
- Status: `healthy`.
- Mode: `azure`.
- Release: `69717769976d209687812b0301922cdce0f642f8`.
- Revision: `ca-vaultspace-web--0000277`.
- Degraded capabilities: none.
- Password-reset token write mode: `hmac`.
- Password-reset recovery configured: true.
- Password-reset writer and delivery contract: version 1.
- Deep health: not called.

## Functional smoke evidence

### CloudVault

CloudVault was verified first with the authorized test account and exact test organization and room
guards.

| Step                              | Result                                    |
| --------------------------------- | ----------------------------------------- |
| Login                             | PASS, HTTP 200                            |
| Session                           | PASS, HTTP 200                            |
| Exact organization and room guard | PASS                                      |
| Bounded document metadata request | PASS, limited to one test record          |
| One test preview                  | PASS, HTTP 200                            |
| Logout                            | PASS, HTTP 200                            |
| Invalidated-session check         | PASS, protected session returned HTTP 401 |

No credential or secret value was written to disk, logs, this document, or a PR description.

### Brightside

The Stakeholder Advisor made an authenticated Brightside session available in the existing
`vaultspace.org` Chrome tab. Verification was limited to the three explicitly approved checks.

| Step                         | Result | Data boundary                                                                                                                                                                                |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated app shell      | PASS   | VaultSpace shell loaded with a main application region, no error page, and no unexpected redirect to login.                                                                                  |
| Known single-room path       | PASS   | The known room route loaded with a main application region and no error state. No room name, room identifier, document metadata, preview, download, export, or content was read or recorded. |
| Logout                       | PASS   | The application logout control returned the session to login with no error state.                                                                                                            |
| Protected route after logout | PASS   | The previously authorized room route required authentication after logout.                                                                                                                   |

Observed anomalies: none. There was no 5xx response, blank shell, or unexpected redirect while the
session was authenticated.

## W0-2 closure evidence

W0-2 remains closed:

- resource-scoped `CanNotDelete` locks remain recorded for PostgreSQL, Storage, Key Vault, and ACR
  in the VaultSpace staging resource group;
- zero-traffic old revisions were deactivated, retained, and not deleted;
- the active release remained healthy through the final deployment and smoke checks;
- the locks are control-plane deletion protection only and do not imply data-plane or application
  authorization protection.

## Rollback record

If a post-closure regression appears:

1. Disable further deployment dispatch.
2. Use the existing pipeline recovery path and the captured immutable previous web and worker
   artifacts.
3. Require one active web revision with 100 percent traffic, Azure readiness, exact previous release
   identity, and quick uncached health.
4. Restore captured job images when the compatibility policy requires it.
5. Run CloudVault smoke first, then only the approved minimal Brightside shell, known-room-path, and
   logout checks.
6. Do not use deep health, customer-data queries, or ad hoc firewall and networking changes to
   diagnose the regression.

## Residual risk and freeze state

- **W0-1 is CLOSED.**
- **W0-2 is CLOSED.**
- **The security freeze remains ACTIVE.**
- W1-1 authorization semantics remains open and requires Advisor GO before implementation.
- W1-2 public-web database privilege split remains open and requires Advisor GO before
  implementation.
- W1-3 schema-driven RLS completeness remains open and requires Advisor GO before implementation.
- P0-4 fail-open `SKIPPED` and large-file malware-scan behavior remains accepted and unchanged.
- A clean dependency audit and Wave 0 closure do not close application authorization, RLS,
  privilege, networking, HA, recovery-objective, or security-header risks.
- No non-hardening feature work is authorized by this closure.

## References

- Security hardening freeze baseline: `docs/SECURITY_HARDENING_FREEZE_2026-08-10_v1.md`
- Worker state analysis: `docs/W0_PIPELINE_WORKER_STATE_HARDENING_2026-08-10_v1.md`
- Deployment contract alignment: `docs/W0_DEPLOYMENT_CONTRACT_ALIGNMENT_2026-08-10_v1.md`
- Reconciler topology correction: `docs/W0_DEPLOYMENT_CONTRACT_ALIGNMENT_2026-08-10_v2.md`
- Reconciler full-template analysis: `docs/W0_RECONCILER_PREFLIGHT_TEMPLATE_2026-08-10_v1.md`
- Reconciler command analysis: `docs/W0_RECONCILER_PREFLIGHT_COMMAND_ARGS_2026-08-10_v1.md`
- Single-revision cutover analysis: `docs/W0_SINGLE_REVISION_WEB_CUTOVER_2026-08-10_v1.md`
- Digest-pinned validation analysis: `docs/W0_DIGEST_PINNED_ENV_VALIDATION_2026-08-10_v1.md`
- HMAC rollback-contract analysis: `docs/W0_HMAC_STEADY_STATE_ROLLBACK_CONTRACT_2026-08-10_v1.md`
- Pull requests: #110, #112, #113, #114, #115, #116, #117, #118, and #119.
- Exact-main CI run: https://github.com/valcros/vaultspace/actions/runs/31450263497
- Successful deployment run: https://github.com/valcros/vaultspace/actions/runs/31450725042
