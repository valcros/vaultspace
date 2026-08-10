# W0 Reconciler Preflight Command and Arguments

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment workflow only

## Decision summary

Proceed with a bounded correction to the execution-only password-reset reconciler preflight command contract.

The live scheduled job already defines:

- command: `["npm"]`;
- arguments: `["run", "worker:password-reset-reconcile"]`.

The deployment workflow will preserve the validated command and change only the execution copy's arguments to `["run", "worker:password-reset-preflight"]`. It will verify both the command and arguments on the created execution before waiting for `Succeeded`.

The scheduled job template, 15-minute schedule, environment, image after recovery, identity, secrets, and steady-state command remain unchanged.

## Triggering evidence

PR #115 merged the full-template execution correction at `d4f58a56f5272f0667d360f2eeca74bcb29d8b91`. PR CI run 31437945120 and exact-main CI run 31438617172 passed. Main CI published immutable web and worker images for that revision.

Deployment run 31439416195 then:

- passed the immutable rollback and image contract;
- completed migrations;
- deployed and verified the target worker image;
- passed HMAC cutover compatibility;
- updated and statically validated the real scheduled reconciler job;
- created a real execution from the complete job template;
- verified the execution used the target immutable worker image;
- stopped before web mutation when the preflight execution failed;
- skipped all web, traffic, delayed-waker, and invitation-lifecycle mutations;
- completed automatic recovery successfully.

Azure execution metadata for `ca-vaultspace-pwreset-recon-d74fatx` showed:

- command: `["npm"]`;
- arguments: `["npm", "run", "worker:password-reset-preflight"]`;
- status: `Failed`.

The complete-template copy correctly preserved the scheduled job's command, but the workflow incorrectly included the executable a second time in the replacement argument array. The resulting invocation shape was equivalent to `npm npm run worker:password-reset-preflight`.

Read-only verification after recovery established:

- web remained on `ca-vaultspace-web--poolfix` at 100 percent traffic;
- quick uncached health remained healthy on release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- the verified forward worker remained healthy and active under the existing recovery policy;
- the reconciler job image was restored to the captured prior digest;
- the reconciler schedule remained `*/15 * * * *`;
- the normal 22:45 scheduled reconciler execution succeeded;
- the deployment workflow remained disabled;
- no customer row, document content, secret value, or Medau resource was queried.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- exact validation of the scheduled reconciler command and arguments;
- one execution-only argument correction;
- verification of the created execution's command and arguments;
- focused regression tests;
- a draft pull request, full CI, merge, exact-main image publication, and one guarded pipeline retry if all gates pass.

Excluded:

- modifying the live scheduled job command, arguments, schedule, environment, identity, secrets, timeout, or trigger;
- changing or weakening the preflight's runtime checks;
- application feature, authorization, RLS, password-reset, malware scan, or firewall changes;
- private networking, HA, geo, CSP, HSTS, or customer communication;
- deep production health;
- Brightside customer-data access or mutation;
- any Medau subscription query or mutation.

## Strawman

### What if the failed preflight exposed a real runtime defect?

The failed execution did not run the intended package script because its immutable execution metadata contains a duplicated executable in the invocation shape. Correcting that orchestration defect does not establish that the application preflight will pass. The next execution must remain authoritative, and any subsequent runtime failure must stop the release without bypass.

### What if the workflow should replace both command and arguments?

Setting command to `["npm"]` and arguments to `["run", "worker:password-reset-preflight"]` would produce the desired invocation. However, replacing both fields broadens the override and weakens the promise that only execution arguments differ from the already validated scheduled template.

The smaller correction validates command `["npm"]`, preserves it, and changes only arguments.

### What if the job image entrypoint should interpret the arguments without a command?

The live job does not rely on the image entrypoint for this task. Azure reports an explicit command `["npm"]` and arguments `["run", "worker:password-reset-reconcile"]`. The preflight must follow that actual contract rather than infer a Docker entrypoint contract.

### What simpler control achieves most of the risk reduction?

Starting the scheduled job without an override would prove only the reconciliation path, not the required runtime preflight. Temporarily changing the scheduled job arguments would introduce a schedule race and mutate steady-state configuration. Removing the preflight would violate the Advisor's authoritative-gate instruction.

The execution-only argument correction is the smallest valid control.

### What user workflows might this break?

- A malformed execution argument array can block the dependency release.
- A mistaken scheduled-template update could interrupt password-reset reconciliation.
- A weakened execution verification could report success for the wrong script.
- A correctly invoked preflight may expose runtime drift and block web cutover.

The workflow must fail before web mutation on any command, argument, image, or execution-status mismatch.

## Steelman

### Blast radius if this is not corrected

Every retry will create an execution that invokes npm incorrectly, fail before web cutover, and repeat worker and job churn while the approved dependency release remains absent from the public web process.

### Defense-in-depth case

Exact command and argument validation proves that:

- the live scheduled job still uses the reviewed `npm run worker:password-reset-reconcile` contract;
- the execution copy changes only the task name from reconciliation to preflight;
- the execution uses the exact target immutable worker image;
- the scheduled template is not changed by the execution override;
- the real runtime preflight must succeed before web mutation.

### Alignment with VaultSpace contracts

The correction preserves immutable artifacts, the real reconciler job, least-privilege environment, first-activation and downgrade guards, automatic recovery, Azure readiness, and quick uncached identity health. It does not claim to close W1 authorization, privilege-split, or RLS work.

### Cost of delay versus careful correction

The implementation changes only workflow command-shape validation and regression assertions. It has no live effect until reviewed CI passes and a pipeline retry reaches the real preflight.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: the scheduled job command shape drifts

Cause:

- an infrastructure change removes or replaces command `["npm"]`;
- arguments no longer equal the reviewed reconciliation script.

Detection within five minutes:

- static job validation requires the exact command and steady-state argument arrays;
- the workflow stops before creating a preflight execution or mutating web.

Rollback:

- no new rollback is needed because the mismatch is detected before the execution and web cutover;
- reconcile infrastructure through a separately reviewed change.

### Failure: the execution still invokes the wrong process

Cause:

- command is duplicated in arguments;
- the wrong task name is used;
- the execution override alters command unexpectedly.

Detection within five minutes:

- regression tests require arguments without the duplicated executable;
- created execution metadata must show command `npm` and arguments `run worker:password-reset-preflight`;
- nonzero execution status blocks web mutation.

Rollback:

- automatic recovery restores captured job images;
- web remains on the captured revision;
- stop and analyze before another retry.

### Failure: a real runtime preflight guard fails after invocation is corrected

Cause:

- constrained database role, Redis, schema, provider-correlation state, audit canary, or rollback verification is unsafe.

Detection within five minutes:

- Azure execution ends `Failed` or `Stopped`;
- workflow stops before web mutation;
- inspect only categorical diagnostics without customer-data queries.

Rollback:

- preserve evidence;
- do not weaken or bypass the preflight;
- escalate for a separately analyzed correction.

### Failure: the scheduled job is changed by the execution override

Cause:

- implementation updates the job rather than its complete execution copy.

Detection:

- code review requires `job start --yaml` against runner-temporary execution data;
- post-failure or post-deploy verification confirms the steady-state command, arguments, image, and schedule;
- scheduled execution history remains healthy.

Rollback:

- restore the captured job image and template through the approved recovery path;
- do not proceed to web cutover.

### Failure: preflight succeeds but web deployment fails

Cause:

- the preflight does not prove web startup, routing, or authentication behavior.

Detection within five minutes:

- Azure revision readiness or quick uncached release identity fails;
- traffic verification fails;
- CloudVault smoke fails after an otherwise green pipeline.

Rollback:

- route traffic to the captured web revision;
- restore captured workload images;
- verify recovery with quick health and Azure readiness only.

## Rollback plan

The workflow must continue to capture the serving web revision, worker revision, reconciler job image, traffic, and release identity before mutation.

If command or argument validation fails, the preflight execution fails, stops, or exceeds five minutes:

1. do not mutate web;
2. restore captured job images;
3. apply the existing compatible-worker recovery policy;
4. verify one active healthy worker revision;
5. verify captured web release identity and 100 percent traffic with quick uncached health;
6. disable the deploy workflow and stop.

## False-confidence controls

Correct execution metadata proves only the intended process was requested. It does not prove the preflight completed.

A `Succeeded` execution proves only the checks implemented by the preflight under that exact template. It does not prove web login, room access, W1 privilege split, RLS completeness, malware policy, or recovery objectives.

A green pipeline still requires CloudVault smoke and the authorized read-only Brightside smoke before W0-1 can close.

## Go or no-go

Go for the exact command-and-arguments correction because immutable Azure execution metadata proves the orchestration defect, the change remains execution-only, and automatic recovery kept public web traffic on the known-good release.

No-go for:

- replacing the executable in both command and arguments without need;
- mutating the scheduled job to run the preflight;
- removing, weakening, or bypassing the real preflight;
- treating a correctly invoked but failed runtime preflight as acceptable;
- printing resolved secrets or querying customer data;
- any application, authz, RLS, scan, firewall, customer-data, or Medau work;
- declaring W0-1 closed before successful deployment and both smoke paths.

## References

- Microsoft Learn, Jobs in Azure Container Apps: https://learn.microsoft.com/en-us/azure/container-apps/jobs
- Microsoft Learn, Jobs Start REST API: https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/start
- Microsoft Learn, Azure CLI `az containerapp job start`: https://learn.microsoft.com/en-us/cli/azure/containerapp/job
