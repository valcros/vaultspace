# W0 Pipeline Worker-State Hardening

Date: 2026-08-10  
Status: Pre-implementation analysis  
Scope: `Deploy to Staging` worker rollback and readiness predicates only  
Subscription boundary: Munger subscription `041a67eb-fec8-41a4-9d70-c35863268cd6`

## Decision summary

Proceed with a bounded deployment-workflow correction.

The current workflow requires the Azure Container Apps worker revision to have the exact
`runningState` value `Running`. The approved worker baseline uses `minReplicas: 0` and
`maxReplicas: 1`. Azure reports this healthy revision as `ScaledToZero` when idle and as
`RunningAtMaxScale` while its single allowed replica is processing work. Both states caused or
would cause the workflow to reject an otherwise active, healthy, provisioned revision.

The correction will preserve strict image, revision, provisioning, health, replica-count, and
single-active-revision checks. It will change only the state predicate:

- `ScaledToZero` is ready only when `minReplicas` is zero and replicas are zero.
- `Running` and `RunningAtMaxScale` are ready when replicas satisfy `minReplicas`.
- `Activating`, `Processing`, `Stopped`, `Degraded`, `Failed`, `Unknown`, missing states, inactive
  revisions, unhealthy revisions, unprovisioned revisions, and under-minimum replica counts remain
  rejected.

The before-state rollback capture will select exactly one active, healthy, provisioned worker
revision. It will not require an idle worker to consume a synthetic job merely to become eligible
as a rollback source.

## Evidence before implementation

- Approved live worker revision before the attempted deploy: `ca-vaultspace-worker--recov1`.
- Live worker image before the attempted deploy:
  `acrvaultspacestaging.azurecr.io/vaultspace-worker:8e8d42c8130c620deaaabf6eb985efad170d673e`.
- Live worker was active and healthy with `minReplicas: 0`, `maxReplicas: 1`, and zero replicas.
- Azure reported the idle state as `ScaledToZero`.
- Deployment run `31428365513` failed in `Capture staging before-state` before migrations or any
  Container App mutation.
- A single-document synthetic CloudVault export with email disabled activated one worker replica.
- Azure then reported the healthy one-replica state as `RunningAtMaxScale`, not `Running`.
- The same strict `Running` equality appears in before-state capture, forward worker verification,
  final worker verification, and rollback readiness.
- Web remained on release `8e8d42c8130c620deaaabf6eb985efad170d673e` and revision
  `ca-vaultspace-web--poolfix` after the failed deployment gate.

## Strawman

### What if the strict state check is intentional?

The strict check may have been intended to prove that a worker process is currently accepting
jobs. Relaxing it carelessly could allow a failed or inactive worker through a security-sensitive
deployment.

The proposed change does not treat every non-running state as ready. It requires the revision to
be active, healthy, provisioned, uniquely active, on the expected pinned image, and compliant with
its configured minimum replica count. Only the two healthy runtime variants observed for this
scale configuration and the documented scale-to-zero state are accepted.

### What simpler control achieves most of the benefit?

A temporary increase to `minReplicas` could force a worker process to remain online during the
deployment. That would avoid changing the workflow for one release.

This is inferior because scaling parameters are revision-scoped Azure state. A direct scale change
would create or alter a production revision outside the pipeline, change the approved cost and
scale-to-zero posture, require a second production mutation to restore it, and leave the workflow
broken for the next idle deployment.

Queuing synthetic work is also insufficient. With `maxReplicas: 1`, Azure reports the active worker
as `RunningAtMaxScale`, which the current workflow rejects. Repeated work submission would add test
side effects without making the predicate correct.

### What workflows might break?

- Rollback could select an idle but unhealthy worker if health and provisioning checks were
  omitted.
- A new worker revision could be accepted before its minimum replicas are ready.
- A scale-to-zero revision could be accepted even when `minReplicas` is greater than zero.
- Recovery could retain a forward worker that is inactive or underprovisioned.
- Loose string matching could accidentally accept `Degraded`, `Failed`, or `Unknown`.

The implementation and tests must explicitly prevent each case.

### Are we optimizing beyond the Beta need?

No. This is not a worker redesign or availability expansion. It makes the existing deployment
guard understand the worker's already approved scale configuration. The smallest viable correction
is in the guard predicates that currently block the release and rollback logic.

## Steelman

### Why this must ship

The approved dependency release cannot pass the existing pipeline while the worker is idle, and it
still cannot pass when one replica is active at the configured maximum. Retrying without correcting
the predicate cannot close W0-1.

### Blast radius if left unfixed

- Known patched dependency images remain undeployed.
- Future safe releases remain blocked whenever the worker uses its normal scale-to-zero posture.
- Operators may be tempted to make ad hoc Azure scale changes or weaken checks during an incident.
- The pipeline provides false confidence because it checks one Azure display state rather than the
  actual health, provisioning, image, and scale contract.

### Defense in depth

The corrected predicate is stricter about the properties that matter:

- exactly one active worker revision;
- healthy and provisioned Azure revision;
- expected pinned ACR digest;
- acceptable state for the configured minimum replica count;
- replicas at or above a nonzero minimum;
- zero replicas only when the minimum is zero.

This keeps the rollback image unambiguous while avoiding a dependency on momentary queue traffic.

### Alignment with VaultSpace contracts

- Deployment remains pipeline-only.
- Build-once and digest pinning remain unchanged.
- Database, RLS, password-reset, job-template, web-health, and rollback gates remain unchanged.
- The live scale-to-zero worker configuration remains unchanged.
- No new secret, role, firewall, networking, or customer-data access is introduced.

### Cost of delay versus careful correction

The correction is localized and testable. Delay leaves the approved dependency closure blocked and
encourages production-state workarounds. A small PR with explicit negative tests has lower risk than
temporarily changing worker scale or manually deploying images.

## Pre-Mortem

Assume this change caused a deployment incident.

### Failure: a failed worker is treated as ready

Cause: the predicate accepts a state string without checking Azure health or provisioning.

Controls:

- require `active == true`;
- require `healthState == Healthy`;
- require `provisioningState == Provisioned`;
- accept only explicit state values;
- reject every unknown or missing state;
- require exactly one active worker revision.

Detection within five minutes:

- workflow logs include image, active, health, provisioning, running state, replicas, minimum
  replicas, and active revision count on every failed readiness attempt;
- final worker readiness runs after web health and traffic convergence;
- Azure revision inspection confirms the exact image and state.

Rollback:

- the workflow retains its existing prior web and worker images;
- failure recovery restores the prior pinned images and web traffic;
- the pipeline predicate PR can be reverted without a schema or data rollback.

### Failure: a required worker replica is missing

Cause: `ScaledToZero` is accepted even when `minReplicas` is greater than zero, or replica count is
ignored for a running state.

Controls:

- accept `ScaledToZero` only when the minimum and actual replica count are both zero;
- require actual replicas to be at least the configured minimum for `Running` and
  `RunningAtMaxScale`;
- add negative tests for under-minimum and contradictory scale-to-zero states.

Detection within five minutes:

- readiness loops report the minimum and actual replica counts;
- a failed predicate stops the deploy before web cutover or invokes the existing rollback path if a
  mutation already occurred.

Rollback:

- retain the prior revision and pinned image;
- revert the predicate PR if Azure returns an unmodeled state.

### Failure: login or room access is disrupted

Cause: the worker update succeeds but a later web or job update fails, or the workflow accepts an
unready forward worker.

Controls:

- do not change web traffic logic or password-reset compatibility checks;
- keep worker verification before web mutation;
- keep quick health, exact release, exact image, single revision, and 100 percent traffic checks;
- run CloudVault login, session, room, document, and logout smoke first after deployment;
- run Brightside read-only single-room smoke only after CloudVault is green.

Detection within five minutes:

- pipeline quick health and convergence validation;
- CloudVault authentication smoke;
- live health release and revision comparison;
- Azure web traffic and worker revision inspection.

Rollback:

- use the existing workflow recovery path and prior revisions;
- no database rollback is expected because this release contains no schema change.

### Failure: green tests create false confidence

Cause: string-based workflow tests prove the desired words exist but not the boolean contract.

Controls:

- extract the worker readiness decision into a small shell function used by the workflow;
- add table-driven tests for idle, running, at-max, activating, processing, stopped, degraded,
  failed, unknown, inactive, unhealthy, unprovisioned, and under-minimum scenarios;
- keep a workflow text contract that ensures every readiness gate calls the shared function.

### Failure: silent hardening looks like broken product

Cause: the deployment changes application behavior or sends customer communication.

Controls:

- no application behavior change;
- no customer notice;
- the synthetic CloudVault worker activation used `sendEmail: false`;
- no Brightside mutation or document content request;
- stop and escalate if the pipeline indicates more than five minutes of user impact.

## Go or no-go

Go, subject to the following gates:

1. The implementation is limited to worker readiness evaluation, its workflow calls, and tests.
2. The predicate requires active, healthy, provisioned, expected image, exact single-active-revision,
   and minimum replica compliance.
3. `ScaledToZero` is accepted only for a zero-minimum worker with zero replicas.
4. `RunningAtMaxScale` is accepted as a healthy running state.
5. Negative states remain rejected by tests.
6. The deployment must again stop before mutation if before-state is ambiguous.
7. The workflow PR receives a clean diff review and green CI before merge.
8. Rollback remains the prior web and worker revision and image set.

## Residual risk

- Azure may introduce a new healthy state value. The fail-closed state allowlist will reject it until
  reviewed.
- A healthy, provisioned, scale-to-zero revision proves platform readiness and configuration, not
  successful processing of a specific future job. Existing CI, CloudVault worker activation, and
  post-deploy readiness provide additional evidence.
- The GitHub workflow remains manually disabled after the bounded dispatch, matching its prior
  repository state. Ownership of that operational setting remains a backlog item.
- P0-4 fail-open malware scanning behavior remains accepted and unchanged.

## References

- Microsoft Learn, Update and deploy changes in Azure Container Apps:
  https://learn.microsoft.com/en-us/azure/container-apps/revisions
- Microsoft Learn, Scaling in Azure Container Apps:
  https://learn.microsoft.com/en-us/azure/container-apps/scale-app
- Failed deployment run: https://github.com/valcros/vaultspace/actions/runs/31428365513
- Approved dependency PR: https://github.com/valcros/vaultspace/pull/110
