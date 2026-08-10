# W0 Deployment Contract Alignment, Reconciler Topology Correction

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment safety only

## Decision summary

Proceed with a narrow follow-up correction to the deployment workflow before retrying the approved Wave 0 release.

The correction will:

- validate the password-reset reconciler against the worker runtime database reference, because both are constrained worker workloads;
- keep Redis and queue-prefix compatibility checks across the web, worker, and reconciler where all three participate in the same queue path;
- require the reconciler's recovery key secret and active key identifier to match the web and worker HMAC configuration;
- continue to forbid `DATABASE_URL_ADMIN` in the reconciler;
- retain the exact job image, command, schedule, single-completion, parallelism, timeout, Azure mode, enablement, and bounded real-job preflight checks;
- keep the existing first-activation and downgrade guards unchanged;
- keep the accepted 15-minute schedule unchanged;
- keep all deploy and recovery probes on quick, uncached identity health only.

This correction does not change the Container App Job configuration or application behavior. It does not implement authorization, RLS, scan, firewall, networking, or customer-data work.

## Triggering evidence

PR #113 merged the first reconciler-authoritative workflow correction at commit `ef969c85f9bc773a600023fe9d54696e3e62b9f8`. Main CI run 31432981625 was green and published immutable web and worker images for that exact revision.

Deployment run 31434146692 then:

- captured the prior web revision, worker revision, job images, and release identity;
- passed image existence and immutable password-reset delivery-contract checks;
- completed migrations;
- updated and verified the final worker image;
- passed HMAC compatibility checks;
- updated the password-reset reconciler image;
- stopped before the real-job preflight and before any web mutation;
- reported `reconciler, web, and worker DATABASE_URL references do not match`;
- completed the workflow recovery path;
- left `ca-vaultspace-web--poolfix` serving 100 percent of web traffic on release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- left quick public health healthy with no observed customer-facing downtime.

Read-only inspection in the Munger subscription established:

- the web `DATABASE_URL` Key Vault reference and value differ from the worker runtime reference and value;
- the reconciler `DATABASE_URL` reference and value exactly match the worker runtime reference and value;
- web, worker, and reconciler `REDIS_URL` references and values match;
- the reconciler has no `DATABASE_URL_ADMIN`;
- the reconciler carries `PASSWORD_RESET_RECOVERY_KEYS` and `PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID`, which the reconciliation code needs to decrypt durable recovery envelopes;
- the reconciler is provisioned on the accepted `*/15 * * * *` schedule with a 600-second timeout;
- the last ten observed scheduled reconciler executions succeeded;
- the deployment workflow is disabled after the single failed retry;
- the public web revision and traffic were not changed by the failed retry.

The failed guard therefore modeled the old web database identity as authoritative for a worker workload. It also classified required recovery configuration as unnecessary. Both assumptions conflict with the real runtime contract.

No secret value, secret URI, customer row, document content, or Medau subscription resource was displayed or queried while collecting this evidence.

## Scope boundaries

Included:

- one new versioned analysis record committed before implementation;
- deployment workflow validation for the existing password-reset reconciler;
- focused workflow regression tests;
- a draft pull request, full CI, merge, and one pipeline retry only if CI is green.

Excluded:

- changing any Key Vault value or credential file;
- changing the reconciler job environment, schedule, timeout, trigger, command, or identity;
- changing the non-secret job name variable already set to the existing Munger resource;
- changing application feature, authorization, RLS, password-reset, or scan semantics;
- private networking, firewall, HA, geo, CSP, HSTS, or customer communication;
- deep production health;
- Brightside customer-data queries, document access, exploit tests, or mutations;
- any Medau subscription query or mutation.

## Strawman

### What if the workflow is correctly detecting an unsafe database mismatch?

Requiring one database identity across all workloads sounds simpler and can prevent accidental deployment against the wrong database. However, the current architecture intentionally has a transitional privilege split: the worker and scheduled reconciler use the same constrained runtime database value, while the old web revision uses a different value. Requiring the reconciler to match both makes a correct worker-role boundary undeployable and couples Wave 0 to the still-unimplemented W1-2 web privilege split.

The simpler valid control is to require the reconciler database reference to match the worker, require it to be secret-backed and verifiable, forbid `DATABASE_URL_ADMIN`, and execute the reconciler's runtime-role preflight before web cutover.

### What if the recovery variables are unnecessary and should be removed from the job?

The deployment preflight can run without decrypting a real recovery envelope, but steady-state reconciliation calls the recovery decryption path. Removing or rejecting the recovery key secret would allow the preflight to pass while scheduled recovery later fails. That would create false confidence.

The workflow should instead require the reconciler's recovery key secret reference and active key identifier to match the web and worker configuration. This is stricter and more relevant than rejecting them.

### What simpler control achieves most of the risk reduction?

The smallest alternative is to delete the database-reference and environment checks and rely only on the job execution result. That would lose useful static evidence and could start a job with privileged or cryptographically incompatible configuration.

The bounded correction keeps the static checks that are supported by the runtime contract and then uses the real job preflight as the authoritative behavior check.

### What user workflows might this break?

- Password reset could be interrupted if a false-positive guard blocks future releases.
- Password reset recovery could fail if the job image and recovery keys do not match the web that wrote the envelope.
- Login or room access could be affected if the deploy proceeds to a broken web image.
- CloudVault smoke could create unintended state if it exceeds the approved minimal test path.

The pipeline remains fail-before-web for job validation and preflight. CloudVault validation remains scoped to login, session, the exact test room, one available document or preview, and logout. Brightside remains read-only.

### Are we optimizing for an ideal multi-workload architecture during Beta?

No. This change recognizes the architecture that is already live and avoids pulling W1-2 into Wave 0. It does not attempt to remove the old web database privilege or redesign job identity. It only makes the release gate accurately verify the existing bounded worker contract.

## Steelman

### Blast radius if this is not corrected

The approved dependency patch remains absent from the public web process. Repeated retries will continue to update and recover non-web workloads before stopping at the same deterministic false comparison. That adds operational churn without reducing the known public dependency risk.

Leaving the recovery-variable rejection in place would also guarantee a second failure after the database check, even though those variables are required for steady-state recovery.

### Defense-in-depth case

The corrected gate will prove all of the following before web cutover:

- exact existing reconciler job identity through the repository variable;
- immutable final worker image in the job;
- expected password-reset reconciler command;
- scheduled trigger with accepted cadence;
- one completion, parallelism one, and timeout at most 600 seconds;
- Azure deployment mode and explicit reconciler enablement;
- secret-backed database and Redis configuration;
- database identity aligned to the constrained worker runtime;
- Redis and queue namespace aligned across producer and consumer workloads;
- matching recovery key source and active key identifier across HMAC writers and reconciler;
- absence of `DATABASE_URL_ADMIN`;
- successful real-job preflight against Redis and the constrained database role;
- clean rollback of the preflight canary transaction.

The existing immutable first-activation and downgrade proofs remain unchanged. Quick health continues to prove served release identity after web cutover, while Azure readiness proves revision and worker state.

### Alignment with VaultSpace contracts

The correction supports least privilege by aligning worker workloads without treating the old web database identity as the target state. It validates cryptographic compatibility, immutable artifacts, runtime role posture, bounded execution, exact release identity, and rollback before traffic movement.

It also follows the explicit Advisor direction that the real reconciler job preflight, not a web-owned boolean, is authoritative for steady-state HMAC.

### Cost of delay versus careful correction

Delay leaves approved dependency fixes undeployed. The correction touches only workflow policy and its regression test, can be reviewed independently, and has no direct production effect until a green pipeline retry. The old web revision continues serving until every pre-cutover gate passes.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: the gate accepts the wrong database role

Cause:

- the reconciler and worker references match but both resolve to an unexpectedly privileged credential.

Detection within five minutes:

- the real reconciler preflight queries the current PostgreSQL role and rejects a superuser or `BYPASSRLS` role;
- startup/runtime guards reject `DATABASE_URL_ADMIN` exposure;
- the deployment stops before web cutover.

Rollback:

- recovery restores the prior job and worker image state;
- the captured web revision remains on 100 percent traffic;
- do not modify database credentials under this work item.

Residual limitation:

- reference equality is not a complete privilege audit. W1-2 and W1-3 remain open.

### Failure: the job has mismatched recovery keys

Cause:

- the job can read Redis and the database but cannot decrypt an envelope produced by web.

Detection within five minutes:

- static validation requires a secret-backed recovery key source and matching active key identifier across web, worker, and job;
- reference mismatch stops before preflight and web cutover.

Rollback:

- restore the prior job image and retain the prior web revision;
- investigate configuration through approved read-only reference comparisons only;
- do not rotate or rewrite keys under Wave 0.

### Failure: legacy environment entries hide excessive job privilege

Cause:

- allowing the existing `SESSION_SECRET` or `APP_URL` to remain could be mistaken for a least-privilege closure.

Detection:

- the analysis and PR explicitly state that W0 does not close workload secret-splitting;
- `DATABASE_URL_ADMIN` remains a hard failure;
- W1-2 remains open and freeze-blocking.

Rollback or mitigation:

- do not mutate the job environment during this release;
- address workload-specific Key Vault access only through the approved W1-2 design and rollout.

### Failure: the real preflight touches customer state

Cause:

- the preflight selects an active membership as a foreign-key anchor and creates canary rows.

Detection within five minutes:

- the preflight wraps the canary writes in one transaction and deliberately rolls it back;
- it compares provider-correlation counts before and after rollback;
- any mismatch or incomplete probe fails the job and prevents web cutover.

Rollback:

- workflow recovery restores images;
- preserve evidence and stop if rollback verification reports a mismatch;
- do not query or modify Brightside rows to diagnose.

Residual limitation:

- the preflight reads one active membership identifier and aggregate/categorical provider-correlation state. This behavior is already part of the approved real-job preflight. It does not return customer fields or document content.

### Failure: a scheduled run overlaps the temporary job image

Cause:

- the workflow updates the job image near a 15-minute schedule boundary.

Detection within five minutes:

- execution metadata shows the run time, status, and image revision;
- failed scheduled or preflight execution stops investigation before web cutover.

Rollback:

- restore the captured prior job image;
- keep the web on the prior revision;
- do not change the accepted schedule under this correction.

### Failure: web cutover occurs before job proof

Cause:

- workflow step ordering regresses.

Detection:

- regression tests assert job validation and preflight occur before the web update step;
- deployment logs record the exact step boundary.

Rollback:

- route 100 percent traffic to the captured prior web revision;
- restore captured worker and job images;
- disable the workflow before another retry.

### Failure: quick health gives false confidence

Cause:

- quick health proves process and release identity but does not actively test every dependency.

Detection within five minutes:

- Azure revision and worker readiness checks run independently;
- the real job preflight checks Redis, database permissions, schema posture, and transaction rollback;
- CloudVault login, session, exact-room, document metadata or preview, and logout smoke follows a successful deploy.

Rollback:

- retain and route to the prior web revision;
- restore prior workload images using the workflow recovery path;
- do not use `deep=true` in production.

## Rollback plan

Before retry, re-read and record the current web revision, worker revision, release SHA, job images, and traffic allocation.

The workflow must continue to:

1. stop before web mutation when static job validation or preflight fails;
2. restore captured job images after a failed pre-cutover attempt;
3. retain the already verified forward worker only when the recovery contract permits it;
4. keep the captured prior web revision available;
5. restore web traffic to the captured revision if a post-cutover check fails;
6. verify recovery with uncached quick identity health and Azure readiness only.

If recovery cannot be verified within five minutes, stop and escalate for a planned window. Do not improvise with deep health, firewall changes, key rotation, customer data, or the Medau subscription.

## False-confidence controls

A green workflow test proves only that the deployment policy text contains the expected invariants. It does not prove the live job configuration, database role, key compatibility, or application behavior.

A green job preflight proves the runtime-role canaries and rollback checks implemented by that job. It does not close W1-2 privilege separation, W1-3 RLS completeness, P0-4 malware scanning, private networking, or formal recovery objectives.

A green production quick health response proves process and release identity plus declared capabilities. It does not replace CloudVault smoke or Azure readiness.

## Go or no-go

Go for the bounded workflow and regression-test correction because the live evidence disproves the merged comparison, the dependency release remains blocked, and all live effects remain behind reviewed CI and pre-cutover gates.

No-go for:

- changing the live job configuration or schedule;
- weakening first-activation or downgrade protection;
- removing the real preflight;
- treating `SESSION_SECRET` or `APP_URL` presence as W1-2 closure;
- any application, authorization, RLS, scan, firewall, customer-data, or Medau work;
- declaring W0-1 closed before a successful deploy and both approved smoke paths.
