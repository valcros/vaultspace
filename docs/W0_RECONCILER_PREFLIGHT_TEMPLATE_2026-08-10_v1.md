# W0 Reconciler Preflight Execution Template

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment workflow only

## Decision summary

Proceed with a bounded correction to the one-off password-reset reconciler preflight invocation.

The deployment workflow will:

- read the already validated live reconciler job's complete `properties.template`;
- create an execution-only copy in GitHub runner temporary storage;
- change only the target container's arguments to invoke `worker:password-reset-preflight`;
- submit that complete template with `az containerapp job start --yaml`;
- verify the created execution carries the expected immutable image and preflight command;
- retain the existing five-minute status bound and require `Succeeded` before any web mutation.

The scheduled job template, 15-minute schedule, environment, image after recovery, and steady-state command remain unchanged.

## Triggering evidence

PR #114 merged the analysis-first reconciler topology correction at `a9832aad726efe44b9504cbc86c9627518eb8fa3`. Main CI run 31435963969 passed and published immutable images for that exact revision.

Deployment run 31437081774 then:

- passed the immutable image and rollback contract;
- completed migrations;
- deployed and verified the final worker image;
- passed HMAC cutover compatibility;
- updated the existing reconciler job image;
- passed the corrected static job, database, Redis, queue, schedule, recovery-key, active-key, and admin-URL checks;
- failed while asking Azure to create the one-off preflight execution;
- did not create a preflight execution;
- did not mutate web or move traffic;
- completed automatic recovery successfully.

Azure returned `ContainerAppImageRequired` because the workflow called `az containerapp job start` with only an argument override. The command therefore submitted an incomplete execution template with no image.

Official Microsoft documentation states that an execution override replaces the job's entire template. The documented safe pattern is to retrieve `properties.template`, edit the complete execution copy, and pass it with `--yaml`.

Read-only and recovery verification after the failure established:

- web remained on `ca-vaultspace-web--poolfix` at 100 percent traffic;
- quick public health remained healthy on release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- the verified final worker remained healthy and active under the existing recovery policy;
- the reconciler job image was restored to the captured prior digest;
- the scheduled 22:15 reconciler execution succeeded;
- the deployment workflow remained disabled;
- no customer row, document content, secret value, or Medau resource was queried.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- one deployment workflow invocation correction;
- focused regression tests;
- a draft pull request, full CI, merge, exact-main image publication, and one pipeline retry if all gates pass.

Excluded:

- modifying the live scheduled job template, command, schedule, environment, identity, secrets, timeout, or trigger;
- changing the preflight's database behavior or weakening its failure conditions;
- application feature, authorization, RLS, password-reset, malware scan, or firewall changes;
- private networking, HA, geo, CSP, HSTS, or customer communication;
- deep production health;
- Brightside customer-data access or mutation;
- any Medau subscription query or mutation.

## Strawman

### What if the simpler fix is to add `--image` and `--container-name`?

Azure CLI accepts image and container parameters for execution overrides. However, Microsoft documents that any override replaces the entire execution template. Supplying only image, name, and arguments could omit the validated environment, resources, volume mounts, and future template fields. The command might create an execution that fails differently or, worse, runs with an incomplete security boundary.

The safer control copies the complete live template and changes only the arguments in the execution copy.

### What if the real preflight is overkill for Wave 0?

The deployment already validates immutable images and static configuration. One could remove the execution and rely on scheduled-job success.

That is insufficient. A scheduled reconciliation run does not execute the preflight's runtime-role, schema, provider-correlation, Redis readiness, canary-write, audit, and rollback proofs. The Advisor explicitly required the real job preflight to be authoritative for steady-state HMAC.

Removing or bypassing the preflight is rejected.

### What if the full-template copy exposes secrets?

The job template contains environment variable names and Key Vault secret references, not resolved secret values. Writing the copy to runner temporary storage still creates sensitive configuration metadata on the ephemeral runner.

Controls:

- use `$RUNNER_TEMP`, not the repository;
- do not print or upload the template;
- do not add it to artifacts;
- rely on runner teardown for disposal;
- log only execution identity and status.

### What simpler control achieves most of the risk reduction?

Starting the job without an override would preserve the full template, but it would run the scheduled reconciliation command instead of the preflight. Temporarily changing the live job command before start would create a schedule-race and mutate steady-state configuration. Both alternatives are rejected.

The execution-only full-template override is the smallest control that runs the approved preflight without changing the scheduled job.

### What user workflows might this break?

- Password-reset recovery could be interrupted if the scheduled job template were accidentally changed.
- Login or room access could be affected only if a later web cutover proceeds after an invalid preflight.
- A preflight transaction could fail on runtime-role or schema drift and block the release.
- A template copy could select the wrong container in a future multi-container job.

The workflow must validate exactly one primary reconciler container, its immutable image, and its command before creating the execution. Any mismatch remains fail-before-web.

## Steelman

### Blast radius if this is not corrected

The approved dependency release cannot reach the public web. Every retry would deploy and recover the worker and job before Azure rejects the same malformed preflight request. That creates repeat operational churn while known dependency fixes remain absent from the public process.

### Defense-in-depth case

The full-template execution preserves and proves:

- the exact validated target image;
- all secret references and non-secret environment needed by the real job;
- CPU, memory, volume mounts, and future template fields;
- the real job identity and Azure-managed access path;
- execution-only preflight arguments;
- no scheduled-template mutation;
- a bounded completion status before web cutover.

The workflow will also inspect the created execution and reject an image or argument mismatch before treating the preflight as valid.

### Alignment with VaultSpace contracts

This approach follows the platform's documented full-template replacement semantics, preserves immutable artifacts and least privilege, keeps the scheduled reconciler authoritative, and retains the first-activation, downgrade, rollback, and quick-health contracts.

It does not claim to close W1-2 workload secret splitting or W1-3 RLS completeness.

### Cost of delay versus careful correction

The correction changes only CI workflow behavior and a regression test. It has no live effect until reviewed CI passes and a pipeline retry reaches the preflight. The public web remains on the captured revision until every pre-cutover gate succeeds.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: the execution copy omits required template fields

Cause:

- the workflow reconstructs a partial template rather than copying the live template.

Detection within five minutes:

- regression tests require a `properties.template` export and `--yaml` start;
- Azure rejects invalid execution templates;
- execution metadata must match the expected image and command;
- web mutation remains later in the workflow.

Rollback:

- automatic recovery restores the captured job and worker images;
- web remains on the captured revision;
- correct the workflow before another retry.

### Failure: the workflow changes the scheduled job command

Cause:

- the implementation updates the job template instead of an execution copy.

Detection:

- code review rejects any `az containerapp job update --args` or equivalent command mutation;
- post-failure and post-deploy job-template validation confirms the scheduled reconciler command;
- scheduled execution history would show command failures.

Rollback:

- restore the captured job image and template through the approved operational path;
- do not continue to web cutover.

### Failure: the execution uses the wrong container or image

Cause:

- array-index assumptions select another container;
- the template changes between static validation and execution start.

Detection within five minutes:

- require exactly one primary reconciler container in the validated live template;
- bind the selected container name;
- inspect the created execution for the exact target image and preflight arguments;
- fail before web mutation on any mismatch.

Rollback:

- let the bounded execution terminate or stop it if necessary;
- recover job and worker images;
- retain prior web traffic.

### Failure: runner temporary configuration is exposed

Cause:

- debug output prints the full template;
- the file is uploaded as an artifact.

Detection:

- workflow review contains no `cat`, artifact upload, or template echo;
- normal logs show only execution name and categorical status.

Rollback or response:

- stop the workflow;
- rotate only if evidence shows a resolved secret value was exposed;
- Key Vault references alone do not reveal secret values, but still treat the metadata as internal.

### Failure: the preflight reports real runtime drift

Cause:

- constrained database role, Redis, schema, provider-correlation state, or rollback canary is unsafe.

Detection within five minutes:

- the execution ends `Failed`;
- categorical job logs identify the guard family without customer-data queries;
- workflow recovery runs before any web mutation.

Rollback:

- preserve evidence;
- do not weaken or bypass the preflight;
- stop and escalate for a separately analyzed correction.

### Failure: preflight succeeds but web deployment fails

Cause:

- the preflight does not prove web startup, routing, or auth behavior.

Detection within five minutes:

- Azure revision readiness and quick uncached release identity fail;
- traffic verification fails;
- CloudVault smoke fails after an otherwise green pipeline.

Rollback:

- route traffic to the captured web revision;
- restore captured workload images;
- verify recovery using quick health and Azure readiness only.

## Rollback plan

The workflow must continue to capture the serving web revision, worker revision, job images, traffic, and release identity before mutation.

If the preflight execution cannot be created, does not match the validated template, fails, stops, or exceeds five minutes:

1. do not mutate web;
2. restore captured job images;
3. apply the existing compatible-worker recovery policy;
4. verify one active healthy worker revision;
5. verify captured web release identity and 100 percent traffic with quick uncached health;
6. disable the deploy workflow and stop.

## False-confidence controls

A successful `az containerapp job start` proves only that Azure accepted the execution template. It does not prove the preflight completed.

A `Succeeded` execution proves only the checks implemented by the preflight under that exact template. It does not prove web login, room access, W1 privilege split, RLS completeness, malware policy, or recovery objectives.

A green pipeline still requires CloudVault smoke and the authorized read-only Brightside smoke before W0-1 can close.

## Go or no-go

Go for the full-template execution-only correction because the failure occurred before the preflight ran, Microsoft documents the required complete-template semantics, and the implementation remains reviewable and reversible.

No-go for:

- adding only image and container name to a partial override;
- mutating the scheduled job command to run the preflight;
- removing, weakening, or bypassing the real preflight;
- printing or uploading the execution template;
- any application, authz, RLS, scan, firewall, customer-data, or Medau work;
- declaring W0-1 closed before successful deployment and both smoke paths.

## References

- Microsoft Learn, Jobs in Azure Container Apps: https://learn.microsoft.com/en-us/azure/container-apps/jobs
- Microsoft Learn, Jobs Start REST API: https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/start
- Microsoft Learn, Azure CLI `az containerapp job start`: https://learn.microsoft.com/en-us/cli/azure/containerapp/job
