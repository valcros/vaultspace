# W0 Single-Revision Web Cutover Correction

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment workflow only

## Decision summary

Proceed with a bounded correction to the Azure Container Apps web cutover and recovery orchestration.

The workflow will:

- activate the captured stable web revision only when Azure reports that revision is inactive;
- retain the existing 100 percent captured-revision traffic normalization while the app is in multiple-revision mode;
- stop issuing explicit traffic assignment commands after the app enters single-revision mode;
- rely on Azure single-revision readiness plus the existing strict active-revision, traffic, image, release, and quick uncached identity checks;
- apply the same idempotent activation rule during automatic recovery;
- add regression tests for both command boundaries.

The authoritative reconciler job preflight, immutable artifact checks, first-activation guard, downgrade guard, worker readiness, 15-minute reconciler schedule, quick health contract, and recovery convergence checks remain strict and unchanged.

## Triggering evidence

PR #116 merged the reconciler preflight command-and-arguments correction at `f30f303f2a98f72cdaaa449d3829aeeb7cccc31a`. PR CI run 31440367572 passed. Exact-main CI run 31441008344 passed after rerunning one externally transient Google Fonts build job, and published immutable web and worker images.

Deployment run 31442259833 then:

- captured the known-good web and worker rollback state;
- passed the immutable artifact and rollback contract;
- completed migrations;
- deployed and verified the target worker image;
- passed HMAC compatibility checks;
- updated and statically validated the real password-reset reconciler job;
- created the full-template preflight execution `ca-vaultspace-pwreset-recon-73wadkf`;
- verified command `npm`, arguments `run worker:password-reset-preflight`, and the exact target immutable worker image;
- observed the authoritative preflight execution reach `Succeeded`;
- stopped before target web image mutation when Azure returned `RevisionAlreadyInRequestedState` for an unconditional activation of the already active captured revision.

Automatic recovery then restored a healthy known-good public web release, but reported a false rollback failure because it repeated two non-idempotent or invalid operations:

- it tried to activate the already active captured revision again;
- after switching to single-revision mode and updating the known-good image, it tried to set `latest=100` explicitly, which Azure rejected in single-revision mode.

The forward path contains the same invalid explicit traffic assignment after entering single-revision mode, so removing it is required before another pipeline retry.

Read-only verification after the failed run established:

- deployment workflow dispatch was disabled again;
- public web was healthy on one active revision with 100 percent traffic;
- quick uncached health reported the known-good release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- worker revision `ca-vaultspace-worker--0000258` was active, healthy, and safely scaled to zero on the verified forward-compatible target worker image;
- the scheduled reconciler job used the target worker image, command `npm`, arguments `run worker:password-reset-reconcile`, schedule `*/15 * * * *`, and successful provisioning state;
- no deep health endpoint, customer row, document content, secret value, or Medau resource was queried.

## Azure behavior relied upon

Azure Container Apps single-revision mode keeps only one active revision and transfers traffic to the latest ready revision. Explicit revision traffic splitting is a multiple-revision-mode operation. The deployment must therefore use explicit traffic normalization only while multiple-revision mode is active, then use Azure readiness and read-only convergence checks after returning to single-revision mode.

Revision activation is stateful. Requesting activation for a revision that Azure already reports active can return `RevisionAlreadyInRequestedState`. The workflow must inspect the captured revision's active state and skip that mutation when it is already active.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- an active-state check before captured-revision activation in forward normalization;
- an active-state check before captured-revision activation in automatic recovery;
- removal of explicit `latest=100` traffic commands after entering single-revision mode;
- preservation of the existing strict forward and recovery convergence verification;
- focused regression tests;
- a draft pull request, full CI, merge, exact-main image publication, and one guarded pipeline retry if all gates pass.

Excluded:

- changing application features, authorization, RLS, authentication, password-reset logic, malware scanning, or database behavior;
- weakening the real reconciler preflight, its full-template execution, or its exact command, arguments, image, identity, environment, secret references, or schedule validation;
- changing the reconciler's existing 15-minute schedule;
- changing first-activation or downgrade policy;
- changing worker scale or readiness policy;
- private networking, firewall, HA, geo, CSP, HSTS, or customer communication;
- deep production health;
- Brightside customer-data access or mutation;
- any Medau subscription query or mutation.

## Strawman

### What if the workflow should keep explicit `latest=100` for clarity?

The latest failed run proves that this command is not valid after the app is placed in single-revision mode. Keeping an invalid command does not add safety. It converts a successful Azure-managed cutover or recovery into a reported failure.

The stronger control is to validate the resulting state: exactly one active revision, exactly 100 percent traffic to that revision, the expected digest-pinned image and release identity, Azure readiness, and quick uncached health.

### What if activation should always be retried to ensure the captured revision is available?

Azure already exposes the revision's active state. Calling activate when that state is true can return `RevisionAlreadyInRequestedState`, as observed. Skipping activation only when the exact captured revision is already active is narrower and safer than ignoring all activation failures.

If the captured revision is inactive, activation remains mandatory and any activation error remains fatal.

### What if the deploy should remain in multiple-revision mode?

That would broaden the change and reintroduce the mixed-build traffic risk that the reviewed single-revision cutover was designed to prevent. This correction does not redesign deployment mode. It aligns commands with the existing reviewed mode transition.

### What simpler control achieves most of the risk reduction?

Ignoring the two Azure CLI exit codes would be smaller in line count but would accept unrelated failures and create false confidence. The bounded state-aware correction distinguishes acceptable no-op conditions from real failures, then proves convergence.

### What user workflows might this break?

- An incorrect active-state query could skip a required activation and block normalization.
- Removing traffic assignment without retaining convergence checks could allow a misrouted release to pass.
- A new web revision might fail readiness after the image update.
- Recovery might restore an image but fail to restore release identity or 100 percent traffic.

Each condition remains fail-closed through the existing Azure readiness, traffic, image, release, and quick uncached identity checks.

## Steelman

### Blast radius if this is not corrected

Every retry can stop on an already satisfied activation request before target web mutation. If it reaches forward cutover, it can then falsely fail on explicit traffic assignment in single-revision mode. Automatic recovery can also report failure after Azure has restored a healthy release, reducing confidence in the rollback signal and extending operator response time.

### Defense-in-depth case

State-aware activation and mode-correct traffic control preserve independent safeguards:

- immutable image and source-revision validation;
- a captured known-good rollback revision;
- strict multiple-mode normalization before mutation;
- Azure single-revision readiness for cutover;
- exact one-revision and 100 percent traffic convergence checks;
- image and release identity checks;
- quick uncached health without deep probes;
- automatic recovery with the same convergence requirements.

### Alignment with VaultSpace contracts

The correction keeps one reviewed control family: deployment orchestration. It preserves the real reconciler job as the steady-state HMAC authority, keeps first-activation and downgrade guards strict, and does not claim to close W1 authorization, privilege-split, or RLS work.

### Cost of delay versus careful correction

The approved dependency release remains absent from the public web process while the known-good release stays live. The correction is small and testable, but another deploy should not be attempted until CI proves the command boundaries and exact-main images are available.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: the workflow skips activation for an inactive captured revision

Cause:

- the active-state query is malformed or reads the wrong revision;
- output normalization treats an unknown value as active.

Detection within five minutes:

- activation is skipped only for exact value `true`;
- subsequent active-revision count, captured image, and 100 percent traffic validation fails before target web mutation.

Rollback:

- web is not yet mutated;
- leave the captured release serving;
- disable dispatch and correct the query in a new analysis-first change.

### Failure: the new web revision never becomes ready

Cause:

- target web startup, dependency, environment, or platform regression.

Detection within five minutes:

- Azure readiness or post-mutation convergence times out;
- quick uncached health fails or returns the wrong revision, release, or contract identity.

Rollback:

- automatic recovery updates the app to the captured digest-pinned image in single-revision mode;
- verify one active revision, 100 percent traffic, captured release identity, and quick health;
- keep the target worker only when the existing compatibility policy proves that is safe.

### Failure: traffic is not 100 percent on the expected revision

Cause:

- Azure has not converged;
- an unexpected active revision remains;
- single-mode routing does not match the latest ready revision.

Detection within five minutes:

- the existing verifier rejects multiple active revisions, split traffic, a latest-revision mismatch, or health from a different revision.

Rollback:

- use the existing recovery path;
- do not add an invalid single-mode traffic command;
- if recovery convergence fails, preserve the last healthy revision and escalate within the downtime budget.

### Failure: recovery reports success while serving the wrong release

Cause:

- an image update creates a revision whose release identity does not match the captured release;
- health is cached or served from another revision.

Detection within five minutes:

- recovery uses cache-busting query identity plus `Cache-Control: no-cache` and `Pragma: no-cache`;
- the verifier requires captured image, captured release SHA, expected revision identity, exactly one active revision, and 100 percent traffic.

Rollback:

- recovery remains failed;
- do not declare the release safe from Azure command success alone;
- retain the prior revision and investigate without customer-data access.

### Failure: the regression test passes despite unsafe command placement

Cause:

- the test only counts command strings and does not bind them to mode-specific sections;
- strict convergence assertions are accidentally removed elsewhere.

Detection:

- tests assert active-state guards in both forward and recovery blocks;
- tests assert that explicit traffic assignment exists only for multiple-mode normalization;
- tests continue requiring all three deployment-contract verifier invocations and quick identity gates;
- human review confirms no application or security-control scope drift.

Rollback:

- do not merge on a test-only green signal;
- restore the previous workflow revision if CI or review exposes a weakened boundary.

## Rollback plan

The workflow must continue to capture the serving web revision, worker revision, job images, traffic, and release identity before mutation.

If forward web readiness, convergence, or quick health fails:

1. inspect whether the captured revision is active;
2. if multiple-revision mode is active and the captured revision is inactive, activate it;
3. while still in multiple-revision mode, route 100 percent traffic to the captured revision and deactivate other revisions;
4. set the app to single-revision mode;
5. update to the captured digest-pinned web image and prior password-reset write mode;
6. do not issue an explicit single-mode traffic command;
7. verify one active healthy revision, 100 percent traffic, captured image and release identity, and quick uncached health;
8. restore job images and worker state under the existing compatibility policy;
9. disable deploy dispatch and stop.

The previous Container App revision remains retained until post-deploy CloudVault and authorized Brightside smoke are green.

## False-confidence controls

An Azure update command returning success does not prove readiness, traffic convergence, image identity, or release identity.

Exactly one active revision does not prove the expected revision owns 100 percent traffic.

Quick health does not prove login, session, room access, W1 privilege split, RLS completeness, malware policy, or customer workflow correctness.

A green pipeline still requires exact-main image evidence, CloudVault smoke, and the authorized read-only Brightside smoke before W0-1 can close.

## Go or no-go

Go for the bounded correction because the real runtime preflight succeeded, Azure emitted precise state and mode errors, the known-good public release remained healthy, and strict post-mutation and recovery verification can remain unchanged.

No-go for:

- ignoring arbitrary Azure activation or traffic errors;
- weakening the reconciler preflight, first-activation guard, downgrade guard, or recovery verification;
- retaining explicit traffic assignment in single-revision mode;
- changing the app to multiple-revision steady state;
- deep production health;
- printing resolved secrets or querying customer data;
- any application, authorization, RLS, scanning, firewall, private-networking, customer-data, or Medau work.

## Implementation and validation plan

1. Commit this analysis record before implementation.
2. Add exact active-state checks around both captured-revision activation sites.
3. Remove both explicit `latest=100` commands that execute after single-revision mode is set.
4. Retain multiple-mode captured-revision traffic normalization and all convergence checks.
5. Add focused regression tests for activation idempotence, mode-correct traffic commands, and retained strict verification.
6. Run formatting, focused tests, full unit tests, type-check, lint, and workflow validation.
7. Open a draft PR and require green PR CI.
8. Merge only after scope review, then require green exact-main CI and immutable image publication.
9. Re-read live Munger-subscription state, normalize the worker rollback baseline if required, and perform one guarded pipeline retry.
10. Run quick health only, CloudVault smoke first, then authorized read-only Brightside smoke. Record digests, revisions, smoke results, and rollback state before declaring W0-1 closed.

## Sources

- Azure Container Apps revisions: https://learn.microsoft.com/en-us/azure/container-apps/revisions
- Azure Container Apps traffic splitting: https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting
- Azure CLI Container Apps revision commands: https://learn.microsoft.com/en-us/cli/azure/containerapp/revision
- Azure CLI Container Apps ingress traffic commands: https://learn.microsoft.com/en-us/cli/azure/containerapp/ingress/traffic
