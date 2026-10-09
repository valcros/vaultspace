# Azure Operational Status (2026-10-08)

Public summary of the repository review and read-only Azure verification. Detailed
resource posture, identifiers, certificate metadata, cost assumptions, and owner
recommendations are retained in gitignored `.private/azure-staging_v2.md` and
`.tmp/azure-review-response-2026-10-08/`. The earlier private record remains available.
Moving details out of this revision does not erase earlier public commits or comments.

## Current verdict

**Operational staging; public-launch evidence remains incomplete.** A fresh quick
health request reports `e7ee77d`, healthy Azure mode, and no degraded capabilities.
Both application images match that commit's unique runnable Linux/AMD64 registry
manifests. All four scheduled jobs match its worker image. These are point-in-time
checks, not a continuous-availability or exhaustive functional guarantee.

PR #188 fixed verification-email provider operation IDs and remediated the critical
Next.js/tinypool findings. PR #192 added preview authentication correction, safe
invitation telemetry, and email failure monitoring. PR #193 corrected download and
thumbnail authentication responses and updated rendering dependencies. Its protected
CI and deployment passed; the approved test-organization smoke passed eleven checks.

A fresh audit of the `e7ee77d` lockfile reports **0 critical, 15 high, 6 moderate, and
0 low** findings across runtime and development dependencies. CI Security Scan passes.
The old P0 critical-advisory blocker is closed; remaining advisories are P1 follow-up.
Audit counts alone do not prove application exploitability or its absence.

## Evidence dates and scope

The original control-plane audit was captured on 2026-10-08 at approximately
20:00-20:15 UTC against `814a6ec`: 11 primary checks were Confirmed and 4 Corrected.
It predates #188, #192, and #193. The follow-up was captured on 2026-10-09 UTC
(2026-10-08 Pacific), and supersedes old current-release and dependency claims.

Azure CLI reads used an explicit subscription without changing the default. No
secret values, certificate private keys, or customer records were requested. This
follow-up performs no deployment, probe change, job execution, role assignment,
credential change, certificate removal, or test notification.

| Check                             | Public result                                                                                                                                                                    | Evidence method                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1.1 App image identity            | Both runnable app digests and all scheduled-job worker digests match `e7ee77d`; active revision state reviewed.                                                                  | App/revision metadata and registry manifests                           |
| 1.2 Readiness                     | Deep readiness and quick liveness are distinct. Retain current behavior pending a bounded, separately reviewed readiness proposal.                                               | App probe metadata and health-route source                             |
| 1.3 ClamAV                        | Worker-side ClamAV configuration remains distinct from the web role. Configuration is not an EICAR or scan-gate test.                                                            | Allowlisted app configuration                                          |
| 1.4 Scheduled jobs                | Four job roles and cadences are listed below; image identity reverified.                                                                                                         | Job configuration metadata                                             |
| 1.5 Maintenance scripts           | Stale-token cleanup and pending-invite scripts are not deployed as scheduled jobs in the reviewed group.                                                                         | Job inventory and source                                               |
| 1.6 Password-reset reconciliation | Runs in its scheduled job. The web-only `reconcilerEnabled=false` flag does not mean the scheduled reconciler is disabled.                                                       | Job metadata, health contract, deploy workflow                         |
| 1.7 Database posture              | Reviewed; findings and owner decisions tracked privately.                                                                                                                        | Explicit-scope configuration and policy metadata                       |
| 1.8 Cache posture                 | Reviewed; findings and owner decisions tracked privately.                                                                                                                        | Explicit-scope configuration metadata                                  |
| 1.9 Storage posture               | Reviewed; findings and owner decisions tracked privately.                                                                                                                        | Configuration metadata and provider source                             |
| 1.10 Secret backing               | Reviewed; findings and owner decisions tracked privately. A `secretRef` check is not proof of Key Vault backing or runtime resolution.                                           | Secret-reference metadata only and validator source                    |
| 1.11 Registry authentication      | Reviewed; migration dependencies and owner decisions tracked privately.                                                                                                          | Workflow source and authentication metadata                            |
| 1.12 Certificates                 | Binding and public TLS metadata reviewed; retention recommendation tracked privately. No certificate removed.                                                                    | Subscription app inventory, environment bindings, public TLS handshake |
| 1.13 Email                        | Verification/signup repair and controlled tests are separate evidence. Provider acceptance does not prove inbox receipt.                                                         | Prior approved delivery evidence; no additional send in this review    |
| 1.14 Monitoring                   | Resource-pressure alerting exists. The two email failure rules from #192 are enabled; endpoint, missing-execution, and notification-receipt evidence remain separate follow-ups. | Alert configuration readback and source                                |
| 1.15 Placement and retention      | Reviewed; resource placement, recovery inventory, and owner decisions tracked privately.                                                                                         | Scoped resource and reference inventory                                |

### Scheduled job inventory

Cadences are UTC. Completion history from the original audit is retained privately
as dated evidence; it is not presented as the latest 24-hour execution window.

| Command                               | Cron           | Timeout |
| ------------------------------------- | -------------- | ------- |
| `worker:wake-delayed`                 | `*/5 * * * *`  | 90 s    |
| `worker:invitation-lifecycle`         | `0 6 * * *`    | 300 s   |
| `worker:password-reset-reconcile`     | `*/15 * * * *` | 600 s   |
| `worker:email-verification-reconcile` | `*/5 * * * *`  | 300 s   |

Job completion does not establish useful work or inbox delivery. The scheduled reset
job should not be duplicated merely to change the web process's health flag.

## Repository corrections in this PR

- Public web examples use placeholders and explicit prerequisites; the probe fragment
  is non-deployable. Examples are not authority for live resource posture.
- Environment catalog and agent/deployment/job documentation agree on configuration
  sources and the scheduled reconciler topology.
- Proposed maintenance schedules remain explicitly unimplemented. Stale-token cleanup
  is an unscheduled script, not a deployed job.
- The certificate workflow consumes the previously owner-approved staging email secret
  and fails before renewal when it is missing. This review did not run renewal.
- Current status, backlog, and changelog reflect #188, #192, and #193. The approved
  temporary handoff removal is retained.

## Remaining decisions and review framework

C1-C7 are **recommendations only**, recorded with scope, evidence, rough cost
assumptions where applicable, verification gates, and rollback considerations in the
private report: readiness; resilience/network/recovery; storage identity; registry
identity; monitoring completion; certificate retention; secret-backing validation.
No recommendation in this report authorizes an Azure mutation.

**Strawman:** retain the working release and complete notification/launch evidence.
This minimizes simultaneous changes but leaves resilience and identity decisions open.
**Steelman:** stage each approved improvement with one clear success criterion and a
usable rollback path; avoid a combined network, identity, readiness, and HA cutover.
**Premortem:** test for cold-start pull failure, dependency-related readiness loss,
blocked storage signing/copy, missing job/log evidence, destructive cleanup scope,
and recovery that exceeds the owner's accepted objectives before each rollout.

For public-document review, check that facts are dated, code state is distinguished
from live state, and resource-specific posture is absent. Deterministic identifier
and credential scanning complements this review; broad posture keyword matching
would misclassify legitimate architecture examples and still miss paraphrases.

## Validation and limits

The current release's CI, E2E, Linux runtime-image checks, deployment, and scoped live
smoke passed. This PR's own checks must be rerun after the owner-specified #189-first
merge sequence. No Docker runs on the owner's workstation; container checks belong
on remote CI. Full manual launch QA, accessibility review, recovery exercises, and
standalone full-stack evidence remain distinct requirements.

The standalone workflow already has path-filtered PR triggers and a manual full-stack
path; the earlier claim of no recorded runs was corrected. Ordinary PR validation
skips the separately gated full-stack smoke.

## Sources

- Private evidence: `.private/azure-staging_v2.md`; `.tmp/azure-review-response-2026-10-08/`.
- [Verification-email and critical dependency fix, #188](https://github.com/valcros/vaultspace/pull/188)
- [Email monitoring and preview fix, #192](https://github.com/valcros/vaultspace/pull/192)
- [Document authentication and dependency fix, #193](https://github.com/valcros/vaultspace/pull/193)
- [Verified release deployment](https://github.com/valcros/vaultspace/actions/runs/37867673820)
- `docs/EMAIL_FAILURE_MONITORING.md` (on main), `.github/workflows/deploy-staging.yml`,
  `scripts/validate-container-env.sh`, `scripts/check-public-repository-safety.mjs`.
