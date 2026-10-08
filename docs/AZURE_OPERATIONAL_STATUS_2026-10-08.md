# Azure Operational Status (2026-10-08)

Point-in-time review of the Azure staging environment. Sources: the public health endpoint, GitHub Actions run history, and the repository's workflows, scripts and `infrastructure/` files. No Azure control-plane access was used, so resource SKUs, replica counts, job schedules and metrics in Azure itself were **not** inspected.

## Verdict

**Operational.** Staging is healthy and serving the current `main` commit. The one urgent item is a critical `next` advisory in the running image (see Risks).

## Live Checks

| Check             | Result                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/health` | `healthy`, `mode=azure`, `degraded=[]`, all 11 capabilities true                                  |
| Deep health       | database healthy (56 ms), cache healthy (4 ms), storage healthy (4 ms)                            |
| Running release   | `814a6ec` (`main` HEAD), web revision `ca-vaultspace-web--0000344`                                |
| Password reset    | token write mode `hmac`; recovery configured; **reconciler disabled** (`reconcilerEnabled=false`) |
| Security headers  | CSP, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy present on `/`                    |

## Pipeline and Scheduled Workflows

| Workflow                     | Latest result                                                         |
| ---------------------------- | --------------------------------------------------------------------- |
| Deploy to Staging            | Success, 2026-09-17 (run 458, `814a6ec`); 13 runs total               |
| Platform Operator Continuity | Hourly; every run in the last 40 hours succeeded                      |
| Renew Wildcard TLS Cert      | Success 2026-10-01 and 2026-09-01 (monthly)                           |
| CI on PRs                    | **Failing** since 2026-09-17: Security Scan finds a critical advisory |
| Standalone Validation        | No recorded runs                                                      |

## Topology (from repository)

- **Web:** Container App, single-revision, 1.0 vCPU / 2 GiB, `minReplicas=1`, Gotenberg sidecar (0.25 vCPU / 0.5 GiB).
- **Worker:** Container App, no ingress, `minReplicas=0`, KEDA Redis wait-list scaling on `high`, `normal`, `low`.
- **Container Apps Jobs (worker image):** delayed-job waker, invitation lifecycle, email-verification reconciler (`*/5 * * * *`, 300 s timeout), optional password-reset reconciler.
- **Data:** Azure Database for PostgreSQL Flexible Server, Azure Managed Redis Enterprise 7.4, Blob Storage (`documents` container), Key Vault secret references.
- **Edge and email:** wildcard Let's Encrypt cert on Container Apps ingress via Azure DNS DNS-01 (no Front Door); Azure Communication Services email on `vaultspace.org`.
- **Deploy:** CI builds images to ACR on push to `main`; `deploy-staging.yml` deploys over OIDC with migrations, digest pinning, quick-health gates and automatic image rollback (migrations are not rolled back).

## Risks and Drift

1. **Critical advisory in production image.** `next` 16.3.5 has SSG/ISR cache poisoning and image-optimizer SSRF advisories; fixed in 16.4.x. `sharp` also needs >=0.35.5. CI blocks all merges until resolved, so no fix can ship without addressing it.
2. **Password-reset reconciler is disabled** in the live runtime. Confirm this is intentional.
3. **Job schedules not in source control.** Waker ("every 2 minutes") and lifecycle ("daily") cron values exist only in docs; the deploy checks only that they are scheduled.
4. **Unwired job scripts.** `worker:stale-token-cleanup` and `worker:send-pending-invites` are intended as scheduled jobs but no workflow deploys or repins them; if they exist in Azure they run stale images. The `JOB_SPECS.md` cron table (audit compaction, trash cleanup, backup snapshot) has no implementation.
5. **`infrastructure/ca-web-complete.yaml` is stale.** It would fail `scripts/validate-container-env.sh` (missing ACS, admin DB and protected-slug vars), sets `SCAN_ENGINE=passthrough`, and uses a deep readiness probe that writes to Redis; `ca-web-probes.yaml` uses the quick probe.
6. **Mixed ACR auth.** CI pushes with ACR admin username/password; deploy uses OIDC. Prefer OIDC/managed identity and disable the ACR admin user.
7. **Config documentation gaps.** `.env.example` omits several variables the deploy validator requires. `DEPLOYMENT.md` says the email-verification reconciler should run at least once per minute; the deploy enforces every 5 minutes.
8. **CI runtime deprecation.** `actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and are being forced onto Node 24.
9. **Hard-coded default email** in `scripts/renew-wildcard-cert.sh` (`ACME_EMAIL` fallback) in a public repository.
10. **Region and SKUs undocumented** in the public repo (by design; held in an operator-only private file).

## Recommended Next Steps

1. Upgrade `next` to 16.4.x and `sharp` to >=0.35.5, confirm CI green, and let the pipeline redeploy.
2. Run an Azure-side check with `az containerapp show` / `az containerapp job list` to confirm replica counts, job cron values and recent job execution status, and record the cron values in the deploy validator.
3. Remove or regenerate `infrastructure/ca-web-complete.yaml` from the live configuration.
4. Wire or retire the stale-token cleanup and pending-invite jobs.
5. Move ACR pushes to OIDC and disable the ACR admin user.
