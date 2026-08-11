# W0 Digest-Pinned Environment Validation Correction

Date: 2026-08-10

Status: Pre-implementation analysis

Scope: Wave 0 deployment validation only

## Decision summary

Proceed with a bounded correction to the worker image repository check in `scripts/validate-container-env.sh`.

The validator currently extracts an image repository with a regular expression that recognizes a tag separator but not an OCI digest separator. It therefore converts the valid immutable reference `vaultspace-worker@sha256:<digest>` into the invalid repository value `vaultspace-worker@sha256` and rejects the approved digest-pinned release.

The correction will:

- recognize both `registry/path/vaultspace-worker:<tag>` and `registry/path/vaultspace-worker@sha256:<digest>` as repository `vaultspace-worker`;
- keep rejecting any reference whose final repository component is not exactly `vaultspace-worker`;
- add focused regression tests for tagged, digest-pinned, and wrong-repository references;
- leave every other environment, image, readiness, HMAC, cutover, recovery, and health control unchanged.

## Triggering evidence

PR #117 merged at `980b37b4067c2974dc152df7dc8c2389aabd0910`. Exact-main CI run 31445116769 passed and published immutable web and worker images.

Guarded deployment run 31446369589 then completed these controls successfully:

- captured and verified the rollback release contract;
- ran migrations;
- updated the worker to the exact immutable target image;
- proved target HMAC compatibility;
- updated and statically validated the real password-reset reconciler job;
- executed the authoritative full-template password-reset reconciler preflight successfully;
- normalized the captured web revision idempotently;
- updated the web to the target image without the earlier single-revision traffic error;
- updated and validated the delayed-waker and invitation-lifecycle job templates.

The next step, `Validate Container App env shape`, rejected the exact target worker image:

```text
ERROR: ca-vaultspace-worker runs image '.../vaultspace-worker@sha256:68fc78e4...'
(repo 'vaultspace-worker@sha256'); expected the 'vaultspace-worker' image.
```

The validator reported one error. All required environment variables, the absence of `DATABASE_URL_ADMIN` from the worker, `ENABLE_RLS=false`, and the worker probes passed. This isolates the failure to repository-name parsing rather than runtime configuration.

Automatic recovery completed successfully. Read-only verification after recovery established:

- deployment workflow dispatch is disabled;
- public web is healthy on revision `ca-vaultspace-web--0000276`, with one replica and 100 percent traffic;
- quick uncached health reports the known-good release `8e8d42c8130c620deaaabf6eb985efad170d673e`;
- worker revision `ca-vaultspace-worker--0000262` is active, healthy, safely scaled to zero, and uses the forward HMAC-compatible immutable worker digest;
- the real password-reset reconciler uses that same forward worker digest, command `npm`, arguments `run worker:password-reset-reconcile`, and the unchanged `*/15 * * * *` schedule;
- the delayed-waker and invitation-lifecycle jobs were restored to their captured images;
- no deep health endpoint, customer row, document content, secret value, or Medau resource was queried.

## Scope boundaries

Included:

- this versioned analysis record, committed before implementation;
- a repository-name parser that accepts tag-pinned and digest-pinned image references;
- an exact comparison with repository name `vaultspace-worker`;
- focused regression tests;
- local validation, a draft pull request, full CI, review, merge, exact-main image publication, and one guarded pipeline retry if every gate passes;
- verification that the existing non-secret `RESET_RECONCILER_JOB_APP` variable remains the sole deployment variable added for this release.

Excluded:

- application features, authorization, RLS, authentication, password-reset behavior, database behavior, or malware scanning;
- environment requirements, Key Vault reference rules, worker probes, or `ENABLE_RLS` policy changes;
- HMAC first-activation, downgrade, compatibility, or reconciler preflight changes;
- any schedule change, including the approved 15-minute reconciler schedule;
- web cutover, worker readiness, or recovery behavior changes;
- deep production health;
- private networking, firewall, HA, geo, CSP, HSTS, or customer communication;
- Brightside customer-data access or mutation;
- any Medau subscription query or mutation.

## Strawman

### What if digest-pinned image references should remain invalid here?

Digest pinning is the stronger deployment identity. The workflow independently resolves and verifies the exact runnable Linux AMD64 manifest before passing the digest-pinned reference to Azure. Rejecting that verified reference while accepting a mutable tag would weaken the deployment contract rather than protect it.

### What if the repository check is unnecessary because the immutable digest already passed verification?

The repository check protects a distinct operational failure mode. A worker Container App previously ran the web image, which could satisfy a network probe without draining the queue. Keeping an exact repository-name assertion provides useful defense in depth.

### What simpler control achieves most of the risk reduction?

Removing the repository check would let the deployment continue, but it would also remove the guard against a web image being assigned to the worker. Changing only the parser preserves that guard with a smaller blast radius.

### What workflows might this break?

- A parser that strips too much could accept `vaultspace-worker-malicious` or a different final path component.
- A parser that assumes every colon is a tag separator could mishandle a registry with a port.
- A sourceable test seam could accidentally skip normal script execution.
- Tests that only inspect source text could pass without executing the parser.

The implementation must compare the final repository component exactly, preserve normal executable behavior, and execute the parsing function in regression tests.

## Steelman

### Blast radius if this is not corrected

Every guarded deployment using the required immutable worker reference will fail after forward workload mutation. Automatic recovery currently protects the public release, but repeated false failures increase operational churn, prolong the live dependency exposure, and exercise rollback unnecessarily.

### Defense-in-depth case

The bounded correction preserves independent controls:

- verified immutable target and rollback artifacts;
- exact source-revision labels;
- strict HMAC first-activation and downgrade gates;
- authoritative real reconciler job preflight;
- exact worker repository identity;
- required secret references and forbidden admin database access;
- worker readiness and probe validation;
- web image, release, revision, traffic, and quick uncached identity checks;
- automatic recovery convergence.

### Alignment with VaultSpace contracts

The pipeline already requires digest-pinned runtime artifacts. The environment validator must understand that same OCI reference format. This is deployment-contract alignment, not a feature or security-policy expansion.

### Cost of delay versus careful correction

The public web remains on the known-good release, so there is no need for an ad hoc production mutation. The approved dependency release remains unshipped. A small parser correction with executable regression tests is lower risk than another retry against a known deterministic failure.

## Pre-Mortem

Assume this correction caused an incident.

### Failure: a web or unrelated image is accepted as the worker

Cause:

- the parser uses substring matching;
- it removes a suffix but does not isolate the final repository path component.

Detection within five minutes:

- regression tests include a wrong repository that contains or resembles the expected name;
- the validator still compares the parsed value with exact string `vaultspace-worker`;
- Azure readiness and the real worker preflight remain downstream gates.

Rollback:

- the validator fails before health convergence can declare success;
- automatic recovery retains or restores the captured release contract;
- disable deployment dispatch and revert only this bounded parser change through a reviewed PR.

### Failure: tagged images stop validating

Cause:

- the parser handles `@sha256:` but no longer removes a conventional `:<tag>` suffix.

Detection within five minutes:

- a regression test executes the parser against a tagged ACR reference;
- local focused tests and full CI fail before merge.

Rollback:

- do not merge or deploy;
- correct the parser without changing deployment behavior.

### Failure: normal validator execution is skipped

Cause:

- a test seam for sourcing the parser is evaluated incorrectly during direct script execution.

Detection within five minutes:

- tests cover direct validator source boundaries as well as parser execution;
- deployment logs must still show both app validations, repository validation, `ENABLE_RLS`, probe validation, and a final validation result.

Rollback:

- the deploy cannot be declared successful without later identity health and smoke gates;
- disable dispatch and restore the previous script revision.

### Failure: a green parser test creates false confidence

Cause:

- the test duplicates parser logic instead of invoking production code;
- the test omits the exact digest-pinned form Azure uses.

Detection:

- tests source and execute the production parser function;
- the digest test uses `registry/path/vaultspace-worker@sha256:` followed by 64 hexadecimal characters;
- the deployment validator still runs against the live Container App template.

Rollback:

- preserve the recovered known-good public release;
- stop on any environment-shape error and investigate without widening scope.

## Rollback plan

The code change is limited to one parser and its tests. If CI or review finds ambiguity, do not merge.

If the guarded retry fails after mutation:

1. allow the existing automatic recovery to restore the captured web image and release identity;
2. verify exactly one active healthy web revision and 100 percent traffic;
3. use quick uncached identity health only;
4. retain the forward worker and reconciler only when the existing HMAC compatibility policy allows it;
5. restore other jobs under the captured deployment contract;
6. disable workflow dispatch and stop;
7. keep prior Container App revisions until final smoke is green.

The rollback does not require a customer-data query, deep health probe, firewall change, or Medau access.

## False-confidence controls

A parser unit test does not prove live environment shape.

A green environment-shape check does not prove web release identity, worker queue behavior, login, session, room access, W1 privilege split, RLS completeness, or malware policy.

A green deployment still requires exact-main artifact evidence, Azure readiness, quick uncached identity health, CloudVault smoke, and the authorized read-only Brightside smoke before W0-1 can close.

## Go or no-go

Go for the bounded correction because the failure is deterministic, the exact invalid parse result is recorded, every adjacent environment control passed, automatic recovery succeeded, and the public release is healthy.

No-go for:

- removing or weakening the exact worker repository guard;
- accepting partial repository-name matches;
- weakening environment, probe, HMAC, reconciler, readiness, identity, or recovery checks;
- changing schedules or deployment variables other than confirming the existing non-secret job name;
- deep production health;
- printing resolved secrets or querying customer data;
- any application, authorization, RLS, scanning, firewall, private-networking, customer-data, or Medau work.

## References

- Azure Container Apps image documentation: https://learn.microsoft.com/en-us/azure/container-apps/containers
- OCI image manifest specification: https://github.com/opencontainers/image-spec/blob/main/manifest.md
- Deployment run 31446369589: https://github.com/valcros/vaultspace/actions/runs/31446369589
