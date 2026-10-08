# Azure Operational Status (2026-10-08)

Point-in-time staging review by Claude (repository and public endpoint) and Codex (read-only Azure control plane, registry manifests, Log Analytics, GitHub configuration, and local validation). Resource identifiers, names, endpoints, image digests, and detailed evidence remain in the gitignored `.private/azure-staging.md` and `.tmp/azure-review/` files.

## Verdict

**Operational staging, with release blockers.** Quick health is healthy and both deployed application digests match the unique Linux/AMD64 manifests for commit `814a6ec`. The scheduled password-reset reconciler is enabled and running; the web health flag describes only the web process. Existing monitoring covers app and database resource pressure, but endpoint availability and scheduled-job failure alerting were not found in the reviewed resource group.

The fresh dependency audit reports **3 critical, 10 high, 6 moderate, and 1 low** findings across runtime and development dependencies. Critical entries are `next`, `vitest`, and its transitive `tinypool`. This supersedes the earlier report of one critical. Installed dependency advisories do not by themselves establish an exploitable application path.

## Azure-Side Verification

Collected on 2026-10-08, approximately 20:00-20:15 UTC. **11 Confirmed, 4 Corrected, 0 Unverifiable** primary checks. Confirmed includes newly established control-plane facts. Limitations are recorded within each check; no claim of subscription-wide completeness or end-to-end mail delivery is made.

All Azure commands below use `--subscription <subscription> -o json` explicitly. The local default subscription did not contain the staging resource group and was not changed. Repository variables are overlaid with the `staging` GitHub Environment variables before resolving resources.

| Check                              | Status    | Sanitized result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Command / evidence                                                                                                                                              |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Apps and image identity        | Confirmed | One active healthy revision per app, both in Single mode. Web: one running replica, min/max 1/3; main container 1 vCPU / 2 GiB and Gotenberg 0.25 / 0.5 GiB. Worker: scaled to zero, min/max 0/1; main 1 / 2 GiB, Gotenberg 0.5 / 1 GiB, ClamAV 1.5 / 3 GiB. Redis KEDA rules cover high/normal/low wait lists with TLS, list threshold 1, activation threshold 0, polling 30 s, cooldown 300 s. Worker has startup/readiness/liveness TCP probes on 3000. Both images match the build's runnable Linux/AMD64 child digest, not the OCI index digest. | `az containerapp show -n <app> -g <rg>`; `az containerapp revision list -n <app> -g <rg>`; `az acr manifest show -r <registry> -n <repository>:<commit>`        |
| 1.2 Web readiness                  | Confirmed | Live readiness is `/api/health?deep=true`, every 30 s, timeout 5 s, delay 15 s, threshold 3. Liveness uses quick `/api/health`, every 30 s, delay 30 s. The deep handler writes a Redis health key. The old quick-probe example did not reflect the live configuration.                                                                                                                                                                                                                                                                               | App show above; `src/app/api/health/route.ts`                                                                                                                   |
| 1.3 ClamAV                         | Confirmed | ClamAV runs as a worker sidecar; worker `SCAN_ENGINE=clamav`. Web has no ClamAV sidecar and uses `SCAN_ENGINE=passthrough`. This verifies configuration, not an EICAR scan or database scan-gating behavior.                                                                                                                                                                                                                                                                                                                                          | App show, container images and allowlisted environment values                                                                                                   |
| 1.4 Scheduled jobs                 | Corrected | Four scheduled jobs, all pinned to the current worker digest. Waker is every **5** minutes, not the documented 2. Inventory and execution evidence below.                                                                                                                                                                                                                                                                                                                                                                                             | `az containerapp job show -n <job> -g <rg>`; `az containerapp job execution list -n <job> -g <rg>`; Log Analytics aggregate query below                         |
| 1.5 Other maintenance jobs         | Confirmed | No Container Apps Job runs `worker:stale-token-cleanup` or `worker:send-pending-invites` in this resource group. Therefore no stale deployment of either was found; the gap is missing scheduling.                                                                                                                                                                                                                                                                                                                                                    | Resource inventory and all four job commands/arguments                                                                                                          |
| 1.6 Password-reset reconciler      | Corrected | Flag absent on web and ordinary worker, but explicitly `true` on the scheduled reset job. Job runs every 15 minutes; 96 retained successes in the preceding 24 hours. Web health `reconcilerEnabled=false` is process-local, not evidence of an inactive job. The deploy workflow explicitly accommodates this split and validates the job separately. Owner intent cannot be inferred, but the configuration matches that documented contract.                                                                                                       | App/job show; `GET https://www.vaultspace.org/api/health`; `src/app/api/health/route.ts`; `.github/workflows/deploy-staging.yml`                                |
| 1.7 PostgreSQL                     | Confirmed | Flexible Server version 15, burstable tier, HA disabled, 7-day backup retention, geo-redundant backup disabled, 32 GiB storage, autogrow disabled, public network access enabled. `require_secure_transport=on`. Firewall reachability and restore success were not tested. Exact SKU/region are private.                                                                                                                                                                                                                                             | `az postgres flexible-server show -n <server> -g <rg>`; `az postgres flexible-server parameter show -s <server> -g <rg> -n require_secure_transport`            |
| 1.8 Redis                          | Confirmed | Azure Managed Redis, Balanced tier, database version 7.4, HA disabled, minimum TLS 1.2, encrypted client protocol, NoCluster, NoEviction, port 10000, public network access enabled. Exact SKU/region are private.                                                                                                                                                                                                                                                                                                                                    | `az redisenterprise show -n <redis> -g <rg>`; `az redisenterprise database list --cluster-name <redis> -g <rg>`                                                 |
| 1.9 Storage                        | Confirmed | Standard LRS, HTTPS-only, TLS 1.2 minimum, anonymous blob access disabled, 30-day blob and container soft delete, versioning enabled. `allowSharedKeyAccess` is unset, which permits Shared Key authorization; it is not disabled.                                                                                                                                                                                                                                                                                                                    | `az storage account show -n <storage> -g <rg>`; `az storage account blob-service-properties show --account-name <storage> -g <rg>`                              |
| 1.10 Key Vault and app secrets     | Corrected | Key Vault uses RBAC, 90-day soft delete, purge protection. Not every Container App secret has a Key Vault reference: web has 2 of 12 without `keyVaultUrl` (protected organization list and registry credential); worker has 2 of 9 (Redis scaler credential and registry credential). These are Container App-managed secret definitions, not evidence that a plaintext value was retrieved or logged. The env validator only checks `secretRef`, not the backing Key Vault URL.                                                                     | `az keyvault show -n <vault> -g <rg>`; app show secret metadata only; `scripts/validate-container-env.sh <rg> <web-app> <worker-app> <worker-container>` passed |
| 1.11 ACR                           | Confirmed | Basic tier; admin user enabled. CI build-push logs into the registry using username/password secrets, while deployment uses Azure OIDC. Runtime registry credential definitions also need migration before disabling the admin account.                                                                                                                                                                                                                                                                                                               | `az acr show -n <registry> -g <rg>`; `.github/workflows/ci.yml`; app registry metadata                                                                          |
| 1.12 Wildcard certificate          | Confirmed | Current wildcard ingress binding points to the certificate expiring **2026-12-30 05:02:50 UTC**. An older uploaded certificate expires 2026-10-18 and is not the current wildcard binding. Apex/www managed certificate entries are separate. Issuance/renewal was not triggered.                                                                                                                                                                                                                                                                     | `az containerapp env certificate list -n <environment> -g <rg>`; app ingress certificate-ID comparison                                                          |
| 1.13 ACS email                     | Confirmed | Domain, SPF, DKIM, and DKIM2 all Verified; provisioning Succeeded. ACS reports DMARC NotStarted; that field alone does not establish whether a DNS DMARC record exists. No messages sent.                                                                                                                                                                                                                                                                                                                                                             | `az communication email domain show --email-service-name <email-service> --domain-name vaultspace.org -g <rg>`                                                  |
| 1.14 Monitoring                    | Corrected | Log Analytics attached and queryable; 14 enabled metric alerts, one enabled email action group, one activity-log alert, zero scheduled-query alerts. Metric coverage includes app CPU/memory/restarts, PostgreSQL CPU/storage/connections/credits, Redis load/memory/evictions. All metric scopes resolve to inventoried resources. No Application Insights or Front Door resource found in this group, and no Application Insights env setting found on the apps. Alert delivery and external monitoring were not tested.                            | `az monitor metrics alert list -g <rg>`; `az monitor scheduled-query list -g <rg>`; `az monitor action-group list -g <rg>`; `az resource list -g <rg>`          |
| 1.15 Region and rollback inventory | Confirmed | Regional resources span two Azure regions; exact placement is private. Inventory has two Container Apps, four jobs, one PostgreSQL server, one Managed Redis cluster, one ACR, one storage account, and one managed environment. No extra active app revision or obvious duplicate rollback compute/database resource found in this group. Older uploaded certificate retained; no deletion proposed without dependency review. This is not a billing audit or a search of other groups.                                                              | `az resource list -g <rg>`; app revision lists; certificate bindings                                                                                            |

### Scheduled job inventory

All four jobs use one completion, parallelism 1, retry limit 1, and the current worker image digest. Cron is UTC.

| Command                               | Cron           | Timeout | Retained successes in last 24 h | Completed executions in 24 h logs |
| ------------------------------------- | -------------- | ------- | ------------------------------- | --------------------------------- |
| `worker:wake-delayed`                 | `*/5 * * * *`  | 90 s    | 100 (history cap)               | 288                               |
| `worker:invitation-lifecycle`         | `0 6 * * *`    | 300 s   | 1                               | 1                                 |
| `worker:password-reset-reconcile`     | `*/15 * * * *` | 600 s   | 96                              | 96                                |
| `worker:email-verification-reconcile` | `*/5 * * * *`  | 300 s   | 100 (history cap)               | 288                               |

No failed retained executions fall in the reviewed 24-hour window. Older retained failures exist for the two reconciler jobs; they are not current-window failures. Execution history is capped, so the 5-minute jobs were also checked in Log Analytics. Deduplicated `Completed` events establish the counts above; no `Failed`, `DeadlineExceeded`, or `BackoffLimitExceeded` execution events appeared in that window. This does not prove email delivery, useful work performed, or absence of all application-level errors. The exact fixed window is recorded privately.

```kusto
ContainerAppSystemLogs_CL
| where TimeGenerated between(datetime(<window-start>) .. datetime(<window-end>))
| where isnotempty(JobName_s) and isnotempty(ExecutionName_s)
| where Reason_s in ('Completed', 'Failed', 'DeadlineExceeded', 'BackoffLimitExceeded')
| summarize by JobName_s, ExecutionName_s, Reason_s
| summarize Executions=count() by JobName_s, Reason_s
```

Command: `az monitor log-analytics query -w <workspace-id> --analytics-query <query>` with the explicit subscription argument above. Only aggregated event metadata was returned, not application messages or tenant records.

## Risks and Drift

1. **P0 dependency release blocker remains.** `next` 16.3.5 has a critical `next/og` advisory plus other advisories; `sharp` requires at least 0.35.5. Dev dependencies `vitest`/`tinypool` also contribute critical findings. Remediation needs a separately approved dependency PR and a fresh audit, not a claim that two upgrades necessarily clear every critical. The Next.js advisory has application-path prerequisites; exploitability was not tested.
2. **Deep readiness remains live.** Dependency disruption can remove otherwise responsive web replicas from service, and every probe writes to Redis. A switch to quick readiness requires an explicit operational decision; this audit did not apply a probe change.
3. **Maintenance scheduling gaps.** No stale-token-cleanup or pending-invite jobs exist. Waker/lifecycle cron values are not enforced by deploy validation. Audit compaction, generic expiry cleanup, trash cleanup, and scheduled backup snapshot remain specification-only; PostgreSQL managed backups are not a replacement for application/blob restore validation.
4. **Mixed credential posture.** ACR admin authentication remains in CI and app secret metadata. Four app-secret definitions lack Key Vault backing. Shared Key authorization remains permitted on storage. Migration must preserve image pulls, CI pushes, and scaler authentication.
5. **Availability and capacity tradeoffs.** PostgreSQL and Redis HA are disabled; PostgreSQL has 7-day local backups, no geo redundancy, and storage autogrow disabled. Public network access is enabled on PostgreSQL and Redis. Review network rules and recovery objectives separately before public launch.
6. **Monitoring gaps are narrower than assumed.** Existing resource-pressure alerts should be retained. Add reviewed endpoint-availability and job-failure coverage and test notification delivery; Application Insights is not presently evidenced.
7. **Repository cleanup completed, awaiting merge.** Phase 2 reconciles public examples and operator guidance. The certificate workflow now consumes the owner-approved staging email secret. No repository example should be applied without resolving placeholders and secret definitions; no YAML was applied during this review.

## Phase 2: Docs and Config Cleanup

**8 Corrected, 0 Confirmed, 0 Unverifiable** cleanup items. Here Corrected means the
requested repository correction is complete; it does not assert a new Azure change.

| Item                      | Status    | Result and validation                                                                                                                                                                                                                                                                            |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 Web YAML              | Corrected | Regenerated complete template from live metadata with placeholders, secret prerequisites, resources, scale, and deep probes. Probe file is a non-deployable reference fragment. Compared probe/env contracts against the live snapshot and `scripts/validate-container-env.sh`.                  |
| 2.2 Environment catalog   | Corrected | Added ACS and role-specific database/protected-slug placeholders; clarified job-only reset enablement, existing recovery key placeholders, Managed Redis, and worker settings. Checked every required validator name against `.env.example`.                                                     |
| 2.3 Deployment guide      | Corrected | Recorded all four actual job cadences/timeouts, five-minute verification reconciliation, process-local reset flag, and the current ACR admin/OIDC split.                                                                                                                                         |
| 2.4 Architecture/comments | Corrected | Distinguished deployed PostgreSQL 15, Managed Redis 7.4, Container Apps ingress, and existing Log Analytics/alerts from future Front Door/Application Insights options. Runtime guard changes are comments only.                                                                                 |
| 2.5 Agent pointers        | Corrected | CLAUDE/CODEX/GEMINI and DEPLOYMENT consistently point to `.env.example` as the variable catalog and runtime/deploy validators as enforcement.                                                                                                                                                    |
| 2.6 Job specification     | Corrected | Labeled proposed compaction, expiry/trash cleanup, and snapshot schedules unimplemented; distinguished manual tools and the four deployed jobs.                                                                                                                                                  |
| 2.7 Certificate email     | Corrected | With explicit owner approval, created staging `ACME_EMAIL` secret from the script's existing address, removed the fallback, and wired the monthly workflow. Verified secret-name presence, shell syntax, and fail-fast behavior when missing. No renewal run; workflow takes effect after merge. |
| 2.8 Backlog/status        | Corrected | Closed corrected documentation items and the false disabled-reconciler inference; retained real dependency, maintenance, credential, monitoring, and availability work.                                                                                                                          |

## Decision Review Before Phase 3

The owner requests strawman, steelman, and premortem reviews before major work.
The following evaluates the next phase; it does not authorize infrastructure changes.

### Strawman: smallest useful next step

Approve a separate dependency remediation PR that clears the critical audit findings,
then run release gates and deploy the reviewed build through the existing protected
pipeline. Keep the current Azure topology and scheduled reconciler arrangement.
This minimizes simultaneous variables and addresses the immediate release blocker.
It leaves admin registry credentials, missing maintenance schedules, readiness coupling,
and endpoint/job alerting unresolved. Its weakest assumption is that an audit-clean
build and existing resource-pressure alerts are enough for a public launch; they are not
sufficient evidence of recovery readiness or end-to-end operation.

### Steelman: strongest practical plan and alternative

Use staged, separately approved changes: dependency remediation first, then missing
availability/job alert coverage and notification verification, then registry identity
migration after proving both CI pushes and runtime cold-start pulls. Review cleanup
jobs, readiness, and data-service availability in separate proposals with explicit
success criteria and recovery plans. Preserve the existing working reset job and
resource-pressure alerts. This gives each failure a smaller set of possible causes
and keeps recovery artifacts usable.

The strongest alternative is a coordinated hardening release that also enables HA,
changes networking, replaces registry credentials, and adds maintenance jobs before
public launch. It can enforce a consistent final posture and avoid repeated windows,
but has greater cost, broader permissions, more coupled failure modes, and a harder
rollback. Current evidence does not establish the load, budget, recovery objectives,
or restore rehearsal needed to justify that scope.

**Recommendation:** approve the narrow dependency PR first, with all critical findings
addressed and the full audit rerun. Prepare the alerting and identity proposals next.
Retain staging status until functional QA and recovery evidence meet launch criteria.
Do not enable a second reset reconciler merely to make the web health flag true.

### Premortem: assume the next release caused an outage or missed work

| Failure scenario                                                                                                                                    | Early signal                                                                    | Gate before change and recovery plan                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js/sharp upgrades land but CI still blocks releases because critical dev-tool findings remain                                                  | Fresh full audit still reports critical entries                                 | Inspect runtime and development findings together, align tooling, run the complete release gates, and retain the verified prior image for controlled rollback. Rollback restores availability, not a claim that vulnerable dependencies are safe. |
| ACR admin is disabled and scaled-to-zero workers cannot pull an image                                                                               | Image-pull failures appear only on a new replica or scheduled execution         | Prove CI push and runtime pull permissions with the proposed identities before retiring credentials. Keep the existing auth path until cold-start verification succeeds and the approved rollback path is documented.                             |
| A readiness change reports healthy while required dependencies fail, or deep readiness removes all web replicas during a transient dependency fault | Quick/deep health diverge; traffic failures or replica readiness churn          | Define what readiness promises, test dependency-failure behavior in an isolated environment, and preserve the prior probe template and image for rollback.                                                                                        |
| New cleanup jobs delete records outside the intended retention scope or process invitations twice                                                   | Dry-run counts differ from the expected tenant/age scope; duplicate-send events | Review scope, idempotency, and destructive behavior; validate on isolated data and rehearse recovery before scheduling. Pause the approved job if its scoped verification fails.                                                                  |
| Resource-pressure alerts stay green while a job silently skips work or email delivery stalls                                                        | Execution succeeds but useful-work/delivery indicators do not advance           | Add job failure/staleness and endpoint checks, verify notification delivery, and use an explicitly approved controlled-mailbox canary for delivery evidence. Job success alone is insufficient.                                                   |
| Database storage fills or restoration exceeds the accepted outage window                                                                            | Capacity warnings fire; restore drill misses its target                         | Establish recovery objectives, verify capacity headroom/autogrow policy, and rehearse database plus blob recovery before changing availability or retention settings.                                                                             |

The Phase 3 checklist in the draft PR remains unchecked. Live mutation, canary mail,
destructive cleanup, and recovery drills require the applicable approval and isolated
test scope before execution.

## Validation

- Azure operations were read-only; no app/job execution, deployment, secret retrieval, restart, role assignment, or resource mutation was performed.
- Live `scripts/validate-container-env.sh` passed using an explicit-subscription CLI wrapper. Its success does not establish that every secret is Key Vault-backed.
- Local type-check and lint passed; unit suite: 177 files passed, 1 skipped; 1,574 tests passed, 7 skipped.
- `npm audit --json` completed with the vulnerabilities above. This is a known release blocker, not a passing security result.
- Standalone validation has now run on this PR; the earlier claim of no recorded runs is superseded. The workflow has path-filtered PR triggers and a manual full-stack path.
- Quick public health returned `healthy`, `mode=azure`, and no degraded capabilities. The audit did not invoke deep health, send mail, or mutate tenant data.

## Sources

- Live, redacted operator evidence: `.private/azure-staging.md`; raw metadata and validation logs: `.tmp/azure-review/` (both gitignored).
- Repository: `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `scripts/validate-container-env.sh`, `src/app/api/health/route.ts`, `src/workers/passwordResetReconciler.ts`.
- [Azure Container Apps job execution history](https://learn.microsoft.com/en-us/azure/container-apps/jobs).
- [Azure Storage Shared Key defaults](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent).
- [Next.js critical ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j).
- [sharp librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
