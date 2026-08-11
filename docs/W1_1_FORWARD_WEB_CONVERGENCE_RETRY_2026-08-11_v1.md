# W1-1 Forward Web Convergence Retry

Date: 2026-08-11

Status: Pre-implementation analysis

Scope: Deployment pipeline timing, regression tests, and this analysis record only

## Decision summary

Proceed with a bounded correction to the forward post-cutover web convergence gate before the replacement W1-1 deployment.

The correction will:

- keep the existing target web update, Azure readiness, immutable image, release identity, traffic, cache, health, and password-reset delivery-contract requirements;
- retry only the read-only forward convergence snapshot after Azure has reported the target revision healthy;
- re-query the latest revision, its immutable image, all active revisions, traffic allocation, and quick uncached public health on every attempt;
- continue to require the exact target runnable digest, exact target release SHA, Azure and health revision agreement, exactly one active web revision, 100 percent traffic to that revision, `Cache-Control: no-store`, and healthy quick health;
- fail after a firm timeout below the five-minute unannounced-impact budget and enter the existing recovery path;
- retain the current strict recovery convergence verification;
- add regression tests for delayed sole-active convergence and persistent identity, image, traffic, and health failures.

The correction will not change application code, authorization, LinkPolicy, RLS, authentication, password-reset behavior, malware scanning, networking, customer-facing behavior, or Azure resource configuration.

## Triggering evidence

W1-1 application slices were merged through PRs #122 and #123. Exact-main CI run 31521593590 passed on `dbf01ec4c96a088e861d8f9ab678966eb8f1ab4a` and published immutable web and worker images.

The single authorized deployment run 31522382038 then:

- captured the W0 rollback state;
- passed artifact, migration, worker, HMAC, reconciler, job, and preflight gates;
- updated the public web to the W1-1 image;
- observed quick uncached health report `healthy`, release `dbf01ec4c96a088e861d8f9ab678966eb8f1ab4a`, and revision `ca-vaultspace-web--0000278`;
- failed the next forward verification because the same snapshot still showed more than one active web revision;
- entered automatic recovery without a second dispatch;
- restored W0 release `69717769976d209687812b0301922cdce0f642f8` on healthy recovery revision `ca-vaultspace-web--0000279` with one active revision and 100 percent traffic.

The forward gate currently takes one snapshot after Azure readiness. The recovery gate uses the same strict deployment-contract verifier inside a bounded loop and required two not-converged attempts before passing on the third. This asymmetry is consistent with Azure control-plane snapshot lag after a healthy target revision is available. It does not justify weakening any identity or routing assertion.

Before this analysis record was created, workflow 251547585 was changed to `disabled_manually`. No deploy run is in progress. GitHub continues to report an older August 10 dispatch, run 31428108038, as `queued` with no jobs and no updates since creation. Normal and force-cancel API requests both returned HTTP 500. This stale record predates the current sequence, did not prevent later deploys, and has not advanced. It must not be mistaken for a newly created deployment during the correction window.

No CloudVault W1-1 matrix, Brightside smoke, deep health, customer-data access, credential change, ad hoc Azure mutation, or Medau subscription operation occurred after the failed deployment.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- one bounded retry mechanism for the forward post-cutover web convergence gate;
- fresh read-only Azure and quick uncached health queries on each attempt;
- a firm retry timeout below five minutes;
- preservation of every existing strict convergence assertion;
- focused regression tests;
- a pipeline-only pull request, exact-main CI and image publication, and one replacement dispatch after the workflow is re-enabled;
- CloudVault W1-1 verification, minimal authorized Brightside smoke, and versioned deployment evidence only after a successful replacement deploy.

Excluded:

- application, PermissionEngine, LinkPolicy, authorization, RLS, database, authentication, or password-reset product changes;
- changing first-activation, downgrade, reconciler, HMAC, migration, worker readiness, or job-image policies;
- changing the reconciler's accepted 15-minute schedule;
- weakening sole-active revision, 100 percent traffic, immutable digest, release identity, health identity, or cache assertions;
- `deep=true` health;
- P0-4, fail-closed scanning, SKIPPED-file behavior, or large-file policy;
- firewall, private networking, HA, geo, CSP, HSTS, or customer communication;
- Brightside document listing, metadata, preview, download, export, content, exploit tests, or customer-row queries;
- any Medau subscription query or mutation;
- more than one replacement deployment dispatch under this authorization.

## Strawman

### What if the sole-active assertion is unnecessarily strict?

Azure may serve 100 percent of traffic from the target while an older revision remains active briefly. It would be simpler to accept that state. However, the governing deployment contract deliberately requires one active revision to prevent mixed-build reachability and to make rollback state unambiguous. The failed run does not disprove that control. It shows only that the forward gate observed Azure before the control plane had converged.

The correction must wait for the contract to become true. It must not redefine the contract.

### What if a retry loop hides a real routing or identity failure?

A permissive loop could repeatedly ignore an incorrect digest, release, revision, traffic split, cached response, or unhealthy app and eventually pass after an unrelated state change. The bounded design avoids that failure mode by rebuilding the entire snapshot every attempt, applying the same strict verifier every time, requiring healthy quick health, and failing closed at the deadline.

The final result is not based on elapsed time alone. It is based on one complete, internally consistent snapshot that satisfies all approved assertions.

### What simpler control achieves most of the risk reduction?

Adding a fixed sleep before the current one-shot verifier would be smaller, but it would either waste time when Azure converges quickly or remain flaky when convergence takes longer than the guessed delay. Retrying only the active-revision query would also be smaller, but it could combine stale image or health information with a newer revision list.

A bounded fresh-snapshot loop is the smallest control that addresses the observed race without creating mixed-time evidence.

### What user workflows might this break?

- The public cutover could remain in recovery for longer before rollback begins.
- A malformed query could cause every attempt to fail even when production is healthy.
- An incorrect retry deadline could consume the full five-minute impact budget.
- Retrying health could accidentally use cached identity or a deep probe.
- A false success could allow CloudVault or Brightside testing against the wrong release.

Controls are a hard timeout below five minutes, cache-busting quick health, `Cache-Control: no-store`, exact release and revision matching, the unchanged recovery path, and CloudVault-first verification.

### Are we expanding W1-1 into infrastructure redesign?

No. The target and rollback topology, single-revision mode, pipeline, Container Apps resources, job schedule, identities, secrets, and release process remain unchanged. This is a timing correction to one read-only verification phase.

## Steelman

### Blast radius if this is not corrected

The first W1-1 deployment already proved that the target can be healthy and exact while the next Azure snapshot still shows two active revisions. Retrying the same application SHA without correcting that asymmetry can reproduce the same false failure, trigger another unnecessary recovery, and extend the period in which reviewed W1-1 authorization controls remain on main but not live.

### Defense-in-depth case

The corrected gate retains independent proof of:

- exact immutable web artifact identity;
- exact source release identity;
- Azure latest-revision identity;
- public health revision identity matching Azure;
- exactly one active web revision;
- exactly 100 percent traffic to that revision;
- healthy quick public health;
- uncached identity through a unique query plus no-cache request headers;
- `Cache-Control: no-store` on the response;
- the existing password-reset deployment contract;
- automatic recovery if the complete state does not converge in time.

Retrying the evidence collection strengthens the temporal consistency of these controls without reducing any of them.

### Alignment with VaultSpace contracts

The change keeps one control family per PR, follows analysis-first implementation, remains reversible, stays within the existing staging pipeline, preserves the prior W0 revision and image, and does not use customer data to validate infrastructure behavior.

It also preserves the approved W1-1 release sequence: pipeline correction, one replacement dispatch, CloudVault matrix, minimal Brightside smoke, versioned evidence, then Advisor close-out. W1-2 and W1-3 remain blocked.

### Cost of delay versus careful correction

W1-1 is reviewed and merged but not live. The public application is healthy on W0, so there is no justification for an unsafe ad hoc deployment. A small, tested pipeline correction is less costly than another known-racy dispatch and keeps rollback within the five-minute operational limit.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: persistent dual-active state is treated as success

Cause:

- the loop accepts target traffic while ignoring another active revision;
- the final attempt bypasses the shared verifier;
- a stale successful attempt is reused after later state changes.

Detection within five minutes:

- every attempt passes one complete fresh snapshot to the existing verifier;
- the verifier still requires exactly one active revision and exactly one 100 percent traffic entry;
- regression tests cover initial dual-active convergence and persistent dual-active failure;
- post-deploy Azure verification independently confirms one active revision and 100 percent traffic.

Rollback:

- the workflow enters the unchanged recovery path at the deadline;
- recovery restores and verifies the captured W0 image and release;
- no third dispatch occurs without a new Advisor GO.

### Failure: wrong image or release eventually passes

Cause:

- the retry loop updates expected values from observed values;
- a query reads a mutable tag instead of the approved runnable digest;
- health is served by a different revision.

Detection within five minutes:

- expected digest and release remain immutable inputs from the deploy candidate;
- the verifier requires the observed image to equal the target runnable digest;
- public health release must equal the exact deployment SHA;
- health revision must equal Azure's latest revision;
- regression tests keep wrong image and wrong release permanently failing.

Rollback:

- fail the forward gate and use automatic recovery;
- retain target and prior revisions for diagnosis;
- do not dispatch again or promote another digest.

### Failure: traffic or health is incorrect but the loop passes

Cause:

- traffic is queried only once outside the loop;
- health status is not checked after identity validation;
- cached health from an older attempt is reused.

Detection within five minutes:

- traffic and health are re-queried inside every attempt;
- each health request carries a unique cache-busting query and no-cache request headers;
- success requires HTTP success, parseable health JSON, `status: healthy`, exact identity, and `Cache-Control: no-store`;
- regression tests keep wrong traffic and unhealthy health failing.

Rollback:

- the retry deadline triggers the existing recovery path;
- quick recovery health and Azure convergence must pass before recovery is reported successful.

### Failure: retries exceed the five-minute impact budget

Cause:

- per-command hangs are not bounded;
- sleep occurs after the deadline;
- a new attempt starts with insufficient remaining time.

Detection within five minutes:

- the retry helper uses a firm wall-clock deadline below five minutes;
- Azure and health operations are bounded by the remaining deadline;
- no sleep begins after the deadline;
- workflow logs show attempt number and categorical failure without secrets.

Rollback:

- the helper exits nonzero at the deadline;
- the workflow immediately enters automatic recovery;
- if recovery also fails, preserve the last healthy reachable state and escalate without another dispatch.

### Failure: the correction changes product or customer data

Cause:

- application files enter the PR;
- a deep health or customer-data probe is added for diagnosis;
- CloudVault or Brightside validation begins before deployment succeeds.

Detection:

- exact-diff review is limited to this document, deployment workflow/helper, and regression tests;
- tests assert no `deep=true` probe exists in deploy or rollback paths;
- no application route, authorization, RLS, database, malware, or customer-facing file is changed;
- CloudVault and Brightside gates remain after successful deployment only.

Rollback:

- reject the PR or revert the pipeline-only commit before dispatch;
- do not compensate with an application change under this work item.

### Failure: workflow enablement starts an unexpected deployment

Cause:

- a deferred `workflow_run` becomes eligible;
- the stale no-job run unexpectedly advances;
- a second operator dispatches during the sequence.

Detection within five minutes:

- compare deploy run IDs immediately before and after enablement;
- verify the workflow state transition without dispatching;
- dispatch once only after the exact main SHA is confirmed;
- stop if any unexpected run appears.

Rollback:

- cancel the unexpected run if GitHub permits and it has not mutated production;
- if it has begun mutation, follow the workflow's existing recovery path;
- do not issue the authorized replacement dispatch until the unexpected run is resolved and a new GO is obtained if necessary.

## Regression test plan

The regression suite must prove:

1. A first snapshot with the target at 100 percent traffic but two active revisions does not pass. A later complete snapshot with one active target revision passes.
2. Persistent dual-active snapshots exhaust the bounded retry and fail.
3. A wrong target release fails and cannot become accepted by retry timing.
4. A wrong immutable image fails.
5. Incorrect traffic fails.
6. Unhealthy or malformed quick health fails.
7. The workflow still re-queries revision, image, active revisions, traffic, and quick uncached health within the retry path.
8. The workflow contains no `deep=true` health probe and retains all existing password-reset deployment-contract verifier inputs.

## Rollback plan

If the replacement deployment fails any forward convergence attempt through the deadline:

1. allow the existing automatic recovery path to restore the captured W0 runnable digest and password-reset write mode;
2. verify recovery with the existing strict bounded convergence loop;
3. confirm quick uncached health reports the captured W0 release and the Azure revision identity;
4. confirm exactly one active web revision and 100 percent traffic;
5. retain the W1-1 and W0 revisions and immutable images;
6. leave the deploy workflow in the safe state required by the incident response;
7. stop without a third dispatch and request a new Advisor GO.

If the correction itself is found defective before dispatch, revert only the pipeline correction through normal Git history and keep production on the current healthy W0 release.

## Go / No-Go

GO for implementation because the Steelman justifies correcting a demonstrated forward-only timing race and the Pre-Mortem preserves a concrete recovery path within the five-minute budget.

NO-GO for deployment unless all of the following are true:

- the analysis commit precedes every workflow implementation commit;
- the exact diff remains pipeline, tests, and documentation only;
- focused local tests and required PR CI are green;
- human review confirms all strict assertions remain intact;
- exact-main CI and image publication succeed;
- no deployment starts while workflow 251547585 is disabled;
- re-enabling the workflow starts no deployment;
- the replacement dispatch targets the exact post-correction main SHA and is the only dispatch under this GO.

## Standing status

- W1-1: merged to main, not live, not closed.
- Production: healthy W0 release `69717769976d209687812b0301922cdce0f642f8` on recovery revision `ca-vaultspace-web--0000279` at the last authorized quick-health check.
- Deploy workflow: disabled for the bounded correction sequence.
- Security freeze: active.
- Silent hardening: active.
- P0-4: accepted and unchanged.
- W1-2 and W1-3: not started and blocked pending W1-1 close-out.

## References

- GitHub Actions deploy run 31522382038
- GitHub Actions exact-main CI run 31521593590
- Main application commit `dbf01ec4c96a088e861d8f9ab678966eb8f1ab4a`
- `.github/workflows/deploy-staging.yml`
- `scripts/verify-password-reset-deployment-contract.mjs`
- `src/lib/deploymentWorkflow.test.ts`
- `docs/W1_1_ROOM_SCOPED_AUTHORIZATION_DESIGN_2026-08-10_v1.md`
- `docs/SECURITY_HARDENING_FREEZE_2026-08-10_DEPLOYMENT_v1.md`
