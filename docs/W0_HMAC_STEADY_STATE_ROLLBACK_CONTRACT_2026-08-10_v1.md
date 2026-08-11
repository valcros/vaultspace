# W0 HMAC Steady-State Rollback Contract Correction

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment artifact compatibility validation only

## Decision summary

Proceed with a bounded correction to the pre-mutation password-reset deployment contract verifier.

The verifier will preserve the strict same-source rule when the currently serving release is not proven to be in the HMAC recovery steady state. This keeps the first-activation guard unchanged.

When quick uncached health is bound to the captured Azure web revision and proves all of the following, the verifier may accept independently sourced rollback artifacts:

- password-reset token write mode is exactly `hmac`;
- password-reset recovery is configured;
- delivery contract version is numeric `1`;
- every captured web, worker, and configured reconciler image independently declares delivery contract version `1`;
- every image has an immutable digest, a full source-revision label, and a reference bound to its inspected tag or digest;
- the captured web image and release remain bound to current public traffic and health identity.

This distinction aligns the pre-mutation gate with the automatic recovery policy, which deliberately may retain a newer, verified contract-v1 worker and reconciler while restoring the previous web release.

## Triggering evidence

PR #118 merged at `6d742116cf5c7f8390279e550b0083d9bd40764f`. Exact-main CI run 31448714910 passed every test, E2E, build, and immutable image-publication job.

Guarded deployment run 31449202267 used that exact SHA. It passed:

- deployment variable validation;
- OIDC login;
- Azure Container Apps CLI capability validation;
- before-state capture;
- target image existence checks.

The next pre-mutation gate failed with:

```text
ERROR: password reset deployment contract verification failed:
rollback web and worker images do not declare the same source revision
```

The run then skipped migrations, the mutation marker, all Container App and job updates, all health convergence steps, and automatic recovery. No production workload mutation occurred.

Read-only verification established the exact captured state:

- public web revision `ca-vaultspace-web--0000276` is healthy with one replica and 100 percent traffic;
- public web uses the known-good release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- worker revision `ca-vaultspace-worker--0000262` is active, healthy, scaled to zero, and uses the previously verified contract-v1 worker from release `980b37b4067c2974dc152df7dc8c2389aabd0910`;
- the real password-reset reconciler uses the same previously verified contract-v1 worker image and the unchanged 15-minute schedule;
- quick uncached health reports token write mode `hmac`, recovery configured, writer version `1`, and numeric delivery contract version `1`;
- the deployment workflow is disabled;
- no deep health endpoint, customer row, document content, secret value, or Medau resource was queried.

The mixed web and consumer source revisions were not accidental drift. Deploy run 31446369589 updated and verified the worker and real reconciler, then failed at the environment-shape gate after the web cutover. Its successful automatic recovery restored the captured web release and intentionally retained the verified forward HMAC consumers under the existing recovery policy.

## Existing contract conflict

The rollout contract currently states that ordinary deployment requires the serving web, worker, and reconciler to share one source revision. That is correct for first activation, where a historical consumer might not understand HMAC flow-only jobs.

After HMAC activation, the workflow uses a versioned delivery contract for compatibility. Automatic recovery may preserve newer compatible consumers because they may already own enriched or flow-only jobs. Requiring source equality at the next deployment makes that reviewed recovery outcome undeployable even though each retained artifact is immutable, contract-v1, ready, and proven against the same HMAC keys and queue contract.

The correction must distinguish first activation from HMAC steady state rather than remove the first-activation control.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- HMAC steady-state classification from the existing quick uncached health body;
- strict same-source rollback validation when HMAC steady state is not proven;
- independent immutable artifact and contract-v1 validation after HMAC steady state is proven;
- regression tests for both modes and negative artifact-binding cases;
- a narrow update to the existing password-reset rollout documentation;
- local validation, a draft pull request, full CI, review, merge, exact-main image publication, and one guarded pipeline retry if every gate passes.

Excluded:

- password-reset feature or runtime logic changes;
- HMAC first-activation or downgrade policy changes;
- real reconciler job command, arguments, identity, environment, Key Vault references, schedule, or preflight changes;
- web cutover, worker readiness, job update, or automatic recovery behavior changes;
- live worker or reconciler normalization to the older web release;
- application features, authorization, RLS, authentication, database behavior, or malware scanning;
- deep production health;
- private networking, firewall, HA, geo, CSP, HSTS, or customer communication;
- Brightside customer-data access or mutation;
- any Medau subscription query or mutation.

## Strawman

### What if same-source rollback is essential even after HMAC activation?

One Git SHA is a strong release-coherence signal, but it is stricter than the versioned compatibility contract and conflicts with the workflow's own recovery behavior. The current public state was produced by successful recovery, not uncontrolled drift. The retained worker and reconciler both declare delivery contract version `1`, use immutable digests, and were verified ready before retention.

Same-source remains mandatory when HMAC steady state cannot be proven. After activation, compatibility is governed by the delivery contract version and runtime preflight, while exact source labels continue to bind each artifact to its own build.

### What if the safer option is to roll the worker and reconciler back to the web SHA?

That would mutate live consumers solely to satisfy a verifier assumption. A prior normalization attempt demonstrated that manual Container App template updates can create unintended revisions or container shapes. The older consumers might also be less appropriate for jobs already written under the newer contract-v1 implementation.

The current consumers are healthy, contract-compatible, and operational. Correcting the pre-mutation model is smaller and safer than forcing source uniformity through live mutation.

### What if public health can falsely claim HMAC steady state?

The verifier already binds quick uncached health to the exact captured Azure revision, image source release, active-revision set, and 100 percent public traffic. The correction will require exact `writeMode=hmac`, `configured=true`, and numeric delivery contract version `1`. Missing, string-valued, legacy, or otherwise ambiguous fields retain strict same-source behavior.

### What simpler control achieves most of the risk reduction?

Removing all rollback source comparisons would unblock the deploy but weaken first activation. A conditional rule based on already-authenticated deployment evidence is slightly more code but preserves the critical boundary.

### What workflows might this break?

- A legacy first activation could be misclassified as steady state.
- Missing health fields could be treated as permissive.
- A tag could disagree with its source-revision label.
- A contract-v0 consumer could be accepted because its source SHA looks valid.
- A healthy web response from the wrong revision could authorize mixed sources.

Each case must remain rejected by exact field checks, independent image validation, current revision and release identity binding, and negative tests.

## Steelman

### Blast radius if this is not corrected

Every future deployment after a recovery-retained consumer release can fail before mutation. The approved dependency release remains absent from the public web, and operators are pushed toward unnecessary manual consumer rollback just to re-establish source uniformity.

### Defense-in-depth case

The conditional correction preserves independent controls:

- immutable digest resolution for every target and rollback image;
- exact full source-revision labels for every image;
- contract version `1` on every image;
- tag-to-source and digest-to-manifest binding;
- strict same-source first activation;
- active web revision, image, release, traffic, and quick uncached health binding;
- one ready captured worker revision;
- strict HMAC downgrade and key-reference checks;
- real reconciler job validation and authoritative full-template preflight;
- automatic recovery and final convergence checks.

### Alignment with VaultSpace contracts

The explicit delivery contract version exists to express compatibility across builds. Source SHA identifies provenance; contract version identifies interface compatibility. HMAC steady-state recovery legitimately needs both concepts rather than treating them as interchangeable.

### Cost of delay versus careful correction

The public service remains healthy and no mutation occurred, so an ad hoc retry is unnecessary. The correction is isolated to the verifier, tests, and its rollout description. A fresh PR and full CI are proportionate to the safety impact.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: first activation accepts a historical incompatible consumer

Cause:

- `writeMode` is missing or legacy but treated as HMAC;
- recovery configured is coerced from a string;
- delivery contract version is not checked as numeric `1`.

Detection within five minutes:

- tests cover legacy mode, missing fields, false recovery configuration, and string-valued contract versions;
- the verifier uses exact type and value comparisons;
- the gate fails before migrations or workload mutation.

Rollback:

- no workload mutation has occurred;
- keep dispatch disabled and correct the verifier through a new reviewed PR.

### Failure: an unbound or mislabeled artifact is accepted

Cause:

- independent-source validation skips tag, digest, label, or contract checks.

Detection within five minutes:

- every artifact still passes the existing `validateImage` function;
- negative tests mutate tag-to-label binding and contract labels;
- target and rollback pinned references remain verifier outputs.

Rollback:

- fail before migrations and workload mutation;
- do not retry against ambiguous image metadata.

### Failure: mixed compatible consumers later fail the real preflight

Cause:

- contract-v1 code has an implementation defect not visible from labels;
- environment or Key Vault reference drift exists.

Detection within five minutes:

- the target worker must become Azure-ready;
- current and desired HMAC compatibility checks remain strict;
- the real reconciler job is updated, statically validated, and executed with the authoritative full template before web mutation.

Rollback:

- automatic recovery restores or retains the captured compatible consumers under the existing policy;
- public web is not mutated before the real preflight succeeds.

### Failure: health from the wrong web revision authorizes the split

Cause:

- cached health or traffic drift returns a different release identity.

Detection within five minutes:

- cache-busting identity, `Cache-Control: no-cache`, and `Pragma: no-cache` remain in the request;
- response must declare `Cache-Control: no-store`;
- health revision and release must match the captured Azure revision and rollback web image;
- exactly one active revision must receive 100 percent traffic.

Rollback:

- verifier fails before migration or mutation;
- retain the known-good public release and investigate read-only.

### Failure: a green test creates false confidence

Cause:

- tests cover only a permissive HMAC case;
- strict first activation silently disappears.

Detection:

- tests assert both acceptance of independently sourced contract-v1 artifacts in proven HMAC steady state and rejection of the same artifacts in legacy or unconfigured state;
- existing malformed input, target source, cache identity, traffic, and convergence tests remain green;
- review confirms the workflow's real reconciler and downgrade gates are unchanged.

Rollback:

- do not merge on partial tests;
- restore the previous verifier if review or CI shows boundary weakening.

## Rollback plan

The implementation affects only pre-mutation verification and documentation. If CI or review identifies ambiguity, do not merge.

If the guarded deployment retry fails before the mutation marker, no Azure recovery action is required.

If it fails after mutation:

1. allow the existing automatic recovery path to run;
2. verify one healthy web revision at 100 percent traffic;
3. verify captured image and release identity with quick uncached health only;
4. retain or restore workers and jobs under the existing contract-v1 HMAC compatibility policy;
5. disable workflow dispatch and stop;
6. keep prior revisions until final smoke is green.

The rollback does not require a customer-data query, deep health probe, firewall change, or Medau access.

## False-confidence controls

Contract version `1` proves the declared delivery interface, not arbitrary application correctness.

A green pre-mutation verifier does not prove the target worker, reconciler execution, web readiness, login, session, room access, W1 privilege split, RLS completeness, or malware policy.

A green deployment still requires exact-main artifact evidence, Azure readiness, quick uncached identity health, CloudVault smoke, and the authorized read-only Brightside smoke before W0-1 can close.

## Go or no-go

Go for the conditional correction because the failure was deterministic and pre-mutation, the mixed state was created by successful reviewed recovery, public health proves HMAC steady state, and every artifact can retain immutable provenance and contract validation.

No-go for:

- removing strict source equality from first activation or ambiguous health states;
- accepting a nonnumeric contract version, non-HMAC write mode, or unconfigured recovery state;
- removing immutable digest, source-label, tag-binding, web identity, traffic, worker readiness, reconciler preflight, or downgrade checks;
- manually normalizing live consumers solely to satisfy source equality;
- deep production health;
- printing resolved secrets or querying customer data;
- any application, authorization, RLS, scanning, firewall, private-networking, customer-data, or Medau work.

## References

- Password-reset delivery rollout contract: `docs/password-reset-delivery-contract-rollout.md`
- Deployment contract verifier: `scripts/verify-password-reset-deployment-contract.mjs`
- Failed pre-mutation deploy run: https://github.com/valcros/vaultspace/actions/runs/31449202267
- OCI image manifest specification: https://github.com/opencontainers/image-spec/blob/main/manifest.md
