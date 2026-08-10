# W0 Deployment Contract Alignment

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment safety only

## Decision summary

Proceed with a small deployment-control correction before retrying the W0 release.

The correction will:

- make the real password-reset reconciler Container App Job, its configuration validation, and its bounded preflight authoritative for steady-state HMAC deployments;
- keep the existing first-activation, recovery-key, least-privilege, and downgrade protections;
- accept the existing 15-minute reconciler schedule during W0 without changing its runtime behavior;
- use only the quick production health endpoint during forward deployment and recovery verification;
- retain explicit release SHA, revision, traffic, capability, Container App, worker, and job checks;
- add the existing reconciler job name as a non-secret GitHub repository variable only after the code change is reviewed and merged.

This correction does not implement W1 work and does not change product behavior, authorization, RLS, malware scanning, networking, customer communication, or customer data.

## Triggering evidence

PR #110 merged the approved dependency baseline at commit abe29d07a14a6a49a9e64ee971738af111327fe6.

PR #112 merged the scale-to-zero-aware worker readiness guard at commit f3fed2c96c85a7bf006f148de7f2fe4b9ae714f6.

Main CI run 31430020608 validated commit f3fed2c96c85a7bf006f148de7f2fe4b9ae714f6 and published immutable web and worker images.

Deployment run 31430650089 then established the following:

- the corrected before-state gate accepted the healthy worker in ScaledToZero state;
- migrations completed;
- worker revision ca-vaultspace-worker--0000250 became healthy, provisioned, and the sole active worker revision;
- the workflow stopped before web mutation at Validate password reset cutover compatibility;
- the prior web revision ca-vaultspace-web--poolfix remained on 100 percent traffic;
- quick public health remained healthy on the prior web release;
- the recovery step completed;
- no customer-facing web cutover or downtime was observed.

The failed gate reported that HMAC mode requires configured recovery and an enabled reconciler job. Read-only inspection showed:

- the public quick health contract reports reset recovery configured as true;
- the public quick health contract reports reconcilerEnabled as false because the web process does not carry the job-only enablement flag;
- Azure already has the scheduled job ca-vaultspace-pwreset-recon;
- that job is provisioned, has PASSWORD_RESET_RECONCILER_ENABLED=true, runs in Azure mode, and has no DATABASE_URL_ADMIN;
- that job has secret-backed runtime database and Redis settings;
- that job runs the password-reset reconciler command every 15 minutes with a 600-second timeout;
- the GitHub repository variable RESET_RECONCILER_JOB_APP is missing;
- the workflow therefore cannot inspect, update, or preflight the real job;
- the workflow also uses deep=true for forward and recovery health probes;
- deep health writes, reads, and deletes a temporary Redis key;
- the Advisor instruction permits quick production health only and forbids routine deep production health.

## Scope boundaries

Included:

- deployment workflow logic for password-reset job verification;
- deployment and recovery health-probe behavior;
- focused deployment-workflow regression tests;
- one versioned analysis record;
- one non-secret repository variable that points to an existing Munger-subscription resource;
- deployment retry after reviewed CI passes.

Excluded:

- changing the reconciler schedule or enabling a new job;
- changing password-reset application semantics;
- adding new Azure resources;
- changing Key Vault values or credential files;
- W1 authorization, privilege split, or RLS implementation;
- fail-closed malware scanning or scan-size changes;
- firewalls, private networking, HA, geo, CSP, HSTS, or customer notices;
- deep production health calls;
- Brightside data queries or invasive tests;
- any Medau subscription query or mutation.

## Strawman

### What if the existing workflow is correct and production is misconfigured?

The workflow encodes a strong desired state: HMAC reset writes should have configured recovery, an enabled reconciler, a bounded schedule, and a preflight. Weakening that contract could allow a future deployment to preserve a broken recovery path.

The observed state does include configuration drift. The repository variable is absent, the web health flag does not describe the real job, and the current job schedule is 15 minutes while the workflow expects five minutes or less.

The correction must not convert those observations into a claim that the full recovery design is closed. It must document the 15-minute schedule and the web health-label mismatch as residual operational risk.

### What simpler control achieves most of the risk reduction?

One alternative is to set PASSWORD_RESET_RECONCILER_ENABLED=true on the web container and change the existing job schedule to five minutes. That would satisfy the current string-based health gate after adding the missing repository variable.

That alternative changes live runtime configuration and job frequency, creates a new web revision before the W0 release, and expands Gate A into a Gate D backlog item. The Advisor explicitly classified the reconcilerEnabled discrepancy as non-blocking operations backlog. It is not the smallest change for the approved dependency release.

Another alternative is to bypass or delete the password-reset checks. That would remove meaningful defense in depth and is rejected.

The smaller control is to point the workflow at the existing job, validate the actual job and its environment, update its immutable image, execute its bounded preflight, and treat the web health flag as advisory rather than authoritative.

### What workflows might this break?

- Password reset could fail if the workflow updates the wrong job or if the preflight command is not safe.
- Deployment could still stop before web cutover if the existing job does not meet the documented contract.
- Recovery could give false confidence if quick health is treated as proof of database, Redis, and Storage behavior.
- A 15-minute reconciler cadence could delay recovery processing compared with the workflow's earlier five-minute target.
- A repository variable typo could make the pipeline query a missing job.

### Are we optimizing for an ideal future state during a single-room Beta?

The application is already using HMAC reset writes and already has the scheduled reconciler job. The immediate objective is not a redesign. It is to deploy approved dependency patches without inventing a false web-owned signal or violating the quick-health-only production rule.

The ideal five-minute schedule and clearer health reporting remain backlog work unless separately approved.

## Steelman

### Blast radius if this is not corrected

The approved W0 dependency release cannot reach the web. Known dependency advisories remain live in the public process, and the scheduled reset job remains on the older image.

Repeated retries would continue updating and recovering the worker before stopping at the same deterministic gate. That creates operational churn without reducing the public web risk.

The existing workflow would also issue deep production health probes after a future web cutover. Those probes mutate Redis and conflict with the Advisor's explicit production test rule.

### Defense-in-depth case

The real job is a stronger verification target than a boolean copied into the web process. The workflow can verify:

- exact job identity;
- immutable target image;
- scheduled trigger;
- bounded cadence and timeout;
- single completion and parallelism;
- Azure deployment mode;
- explicit reconciler enablement in the job that runs it;
- secret-backed runtime database and Redis settings;
- absence of DATABASE_URL_ADMIN and unnecessary web secrets;
- matching queue configuration;
- successful bounded preflight before web cutover.

Retaining those checks gives stronger evidence than requiring the web container to assert that an external job is enabled.

Quick health still verifies the served release SHA, revision identity, deployment mode, overall liveness, reset mode, recovery-key availability, and required Azure capabilities. Azure control-plane checks separately verify revision health, image digests, traffic, job shape, and worker readiness.

### Alignment with VaultSpace contracts

This approach preserves least privilege, immutable artifacts, exact-release identity, job preflight, rollback revisions, and pipeline-only deployment. It removes a production probe that mutates Redis and keeps the existing customer-data restrictions.

It also keeps the worker free of DATABASE_URL_ADMIN and does not change the accepted fail-open malware policy.

### Cost of delay versus careful correction

Delay leaves the approved dependency fixes undeployed. The proposed change is limited to deployment controls, is locally testable, and can be rolled back by restoring the previous workflow revision. The live app remains on the prior web revision until all gates pass.

## Pre-Mortem

Assume the correction caused an incident.

### Failure: the pipeline updates the wrong Container App Job

Cause:

- the new repository variable contains the wrong name.

Detection within five minutes:

- Azure job lookup or contract validation fails before web mutation;
- expected command, trigger, environment, or secret-reference comparisons fail;
- deployment run identifies the exact failed step.

Rollback:

- web remains on the captured revision;
- the workflow restores any job image it changed;
- correct or remove the non-secret variable before another retry.

### Failure: the new reset job image cannot run

Cause:

- dependency or runtime incompatibility in the worker image;
- job command or environment drift.

Detection within five minutes:

- the bounded preflight fails or times out before web cutover;
- the deployment recovery step restores the captured job and worker images.

Rollback:

- retain and restore the previous job image digest;
- keep the prior web revision serving 100 percent traffic;
- do not proceed to CloudVault or Brightside smoke until recovery is verified.

### Failure: quick health is green while a dependency is unavailable

Cause:

- quick health does not actively query PostgreSQL, Redis, or Storage.

Detection within five minutes:

- Container App revision and health state checks fail;
- worker readiness or job preflight fails;
- CloudVault login, session, room, and document metadata smoke fails;
- public capabilities do not match Azure mode requirements.

Rollback:

- route traffic to the captured prior web revision;
- restore captured worker and job images;
- use Azure control-plane and CloudVault synthetic evidence to diagnose without querying Brightside data.

Residual limitation:

- quick health alone is not a dependency test. This is intentional under the Advisor's production rule and is compensated by non-customer smoke plus control-plane verification.

### Failure: steady-state HMAC deploy loses recovery protection

Cause:

- the workflow stops requiring the misleading web health flag but fails to validate the actual job.

Detection within five minutes:

- regression tests require the actual job validation and preflight steps;
- deployment requires a non-empty job variable in HMAC mode;
- job environment must explicitly enable the reconciler;
- missing recovery keys, mismatched Key Vault references, privileged database access, unsafe cadence, or preflight failure stops before web cutover.

Rollback:

- retain the prior web revision and restore the captured job and worker images.

### Failure: the 15-minute cadence delays a reset-delivery recovery action

Cause:

- W0 preserves the current accepted cadence instead of tightening it to five minutes.

Detection:

- operations can inspect job execution status and password-reset delivery metrics without customer-data dumps.

Rollback or mitigation:

- the W0 change does not alter the current cadence, so there is no behavior rollback;
- track cadence tightening and health-contract clarity in the existing operations backlog;
- obtain Advisor approval before changing customer-visible recovery timing if needed.

### Failure: recovery verification silently uses deep health

Cause:

- one deep=true call remains in the workflow.

Detection:

- CI test scans the deployment workflow and fails if deep=true remains;
- review checks both forward and recovery health URLs.

Rollback:

- revert the workflow PR and retain the prior live revision;
- do not retry production deployment until the quick-only contract is restored.

### Failure: silent hardening looks like broken product behavior

Cause:

- reset delivery, login, or room access changes during the release.

Detection within five minutes:

- CloudVault smoke runs first with synthetic/test data;
- minimal Brightside authentication and single-room path review follows only after CloudVault passes;
- no Brightside document content is opened or queried.

Rollback:

- route 100 percent web traffic to the retained prior revision;
- restore prior worker and job images;
- escalate if customer-visible impact could exceed five minutes.

## Verification plan

Before merge:

- inspect exact file scope;
- run npm ci if the working tree dependency state is uncertain;
- run type-check;
- run lint;
- run focused deployment workflow tests;
- run full unit tests if time permits;
- run Prettier validation;
- run git diff --check;
- require GitHub CI, E2E, security audit, RLS integration, deployment-mode tests, and Docker build to pass.

After merge and before deploy:

- verify the exact main SHA and published image digests;
- verify the prior web and worker revisions again;
- set RESET_RECONCILER_JOB_APP to the existing Munger resource name as a non-secret repository variable;
- leave the deploy workflow disabled except long enough to release one exact-SHA run;
- confirm no duplicate deployment job exists.

After deploy:

- use quick health only on vaultspace.org;
- verify release SHA, revision, mode, capabilities, and reset contract fields;
- verify the web revision is healthy and receives 100 percent traffic;
- verify the worker revision and actual reconciler job are healthy and use expected immutable digests;
- run CloudVault login, session, room, one document metadata or preview, and logout smoke;
- run minimal read-only Brightside login, app load, known single-room path, and logout review;
- record downtime, rollback revisions, image digests, run IDs, and residual risk.

## Rollback plan

The pipeline retains the captured prior web revision, worker revision, and job images.

If the forward deployment fails:

- restore captured worker and job image digests;
- restore or reactivate the captured web revision;
- route 100 percent traffic to the captured web revision;
- verify quick release identity and revision;
- keep the deployment workflow disabled;
- do not delete prior revisions.

The repository correction can be reverted in a small follow-up PR. The non-secret job-name variable can be removed or corrected without exposing credentials.

## Residual risk

- The password-reset reconciler remains on its existing 15-minute cadence, not the earlier five-minute target.
- The public health response continues to report reconcilerEnabled=false because the web process does not own or mirror the job flag.
- Quick health does not prove PostgreSQL, Redis, or Storage behavior by itself.
- W1 authorization, admin database separation, and complete RLS remain open.
- P0-4 fail-open and SKIPPED malware behavior remains accepted and unchanged.
- The deploy workflow remains manually disabled between controlled releases.
- The older inert queued run 31428108038 remains a GitHub Actions anomaly with no assigned jobs.

## Go or no-go

Go, subject to the following gates:

- this analysis record is committed before implementation;
- the change remains limited to deployment controls and focused tests;
- the actual reconciler job remains mandatory and fully validated for HMAC mode;
- no deep production health URL remains in the deploy workflow;
- CI is green for the exact merge SHA;
- the existing job-name variable is added without secrets;
- the prior revisions and image digests remain available;
- CloudVault passes before any Brightside read-only review;
- observed customer impact remains within five minutes.

## References

- Stakeholder Advisor, Lead Dev Instructions, Wave 0 and test-environment rules, supplied in the working session on 2026-08-10.
- GitHub PR #110, security: patch W0-1 dependency baseline.
- GitHub PR #112, fix: make worker deploy gates scale-to-zero aware.
- GitHub Actions CI run 31430020608.
- GitHub Actions deployment run 31430650089.
- .github/workflows/deploy-staging.yml.
- src/app/api/health/route.ts.
- src/lib/deploymentWorkflow.test.ts.
- Azure Container Apps job ca-vaultspace-pwreset-recon in rg-vaultspace-staging, Munger subscription, read-only inspection on 2026-08-10.
