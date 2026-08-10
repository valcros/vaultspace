# VaultSpace Security Hardening Freeze

Date: 2026-08-10  
Status: Active  
Customer boundary: Brightside is the private-data Beta. CloudSpace and synthetic organizations are the verification environments.

## Scope controls

- Non-hardening product work is frozen until the Wave 1 definition of done is met or reprioritized in writing.
- Changes are silent. No customer email, banner, or public status notice is part of this work.
- Brightside data is not used for invasive, destructive, cross-tenant, or malware testing.
- Unannounced production impact must remain at or below five minutes.
- Malware scan fail-closed behavior, private networking, HA redesign, CSP overhaul, and other Wave 2 controls are excluded.
- The current `SKIPPED` malware-scan behavior is an explicitly accepted residual risk for this phase.

## W0-1: Dependency and release baseline

### Strawman

- The reported dependency findings may not all be reachable in VaultSpace. Upgrading every transitive package at once could create more deployment risk than it removes.
- A Next.js patch can alter middleware, App Router, Server Action, caching, or standalone-build behavior even when semver indicates a patch release.
- Replacing the nested Sharp build can alter image decoding, native binary selection, preview behavior, or container build requirements.
- PostCSS is primarily build-time in this application. A broad toolchain refresh would be overkill if a narrow override update closes the advisory.
- Brightside is a single-room Beta. Dependency work should not be used as a reason to mix in authorization, RLS, networking, or UI changes.
- The simpler control is a minimal patch set, a clean reproducible build, and explicit verification that affected versions are absent from the production tree.

### Steelman

- The live release uses Next.js 16.2.9, which is within ranges covered by current high-severity advisories and has a patched 16.2.11 release.
- VaultSpace processes untrusted document and image content, making the nested Sharp and libvips exposure relevant even when the root Sharp version is newer.
- The public web process currently has a high database and secret blast radius. Removing known web-framework attack paths is a meaningful containment measure before the privilege split is complete.
- The local lock file contains PostCSS 8.5.16 and a Next.js-nested Sharp 0.34.5. Merely changing a top-level version without checking the resolved tree would provide false assurance.
- The local `main` branch also includes reviewed security hardening not present in the live release, including transactional-email HTML escaping.
- A minimal security dependency release on the current 16.2 LTS patch line is substantially less risky than delaying known fixes while the public Beta remains online.

### Pre-Mortem

Assume the dependency release caused an incident.

1. Login or middleware routing fails.
   - Detection: CloudSpace login, session refresh, logout, protected-route redirect, and room-open smoke tests fail before production traffic moves.
   - Rollback: restore traffic to the previous healthy Container App revision.
2. Sharp fails to load or document previews fail.
   - Detection: clean container build, direct dependency-tree verification, image-processing unit tests, and a synthetic CloudSpace preview smoke test.
   - Rollback: restore the previous web and worker revisions together so their processing contracts remain aligned.
3. The lock file looks patched but the image still contains an affected nested version.
   - Detection: inspect the clean production dependency tree and record the exact versions before building; verify the built release rather than relying only on manifest ranges.
   - Rollback: do not promote traffic if the production tree still contains an unaccepted high advisory.
4. A clean audit creates false confidence because application authorization and RLS risks remain.
   - Detection: the release evidence explicitly lists W1-1 through W1-3 as open and retains the accepted malware-scan residual risk.
   - Rollback: not applicable to the risk statement; dependency closure is not recorded as overall security closure.
5. Deployment exceeds five minutes or both web and worker become unavailable.
   - Detection: use the existing revision-based deployment workflow, retain the previous revisions, and monitor quick health without calling the state-changing deep health check in production.
   - Rollback: shift traffic to the previous web revision and reactivate the previous worker revision immediately.

### Go/no-go

Proceed with a minimal patch set only if all of the following are true:

- Next.js resolves to at least the patched 16.2.11 release.
- PostCSS resolves to at least 8.5.18.
- No production Sharp installation below 0.35.0 remains.
- The production audit has no undocumented high-severity findings.
- Type-check, lint, unit tests, and safe integration tests pass from a clean install.
- CloudSpace login, room open, and a synthetic preview smoke test pass before production traffic moves.
- The previous healthy revisions and their release identifiers are recorded and remain available for rollback.

Decision: **GO for implementation on the current 16.2 LTS patch line, subject to the validation gates above.**

## Evidence record

To be completed before deployment:

- Dependency versions before and after: Next.js 16.2.9 to 16.2.12; nested Sharp 0.34.5 to deduplicated 0.35.3; libvips to 8.18.3; PostCSS 8.5.16 to 8.5.26; DOMPurify 3.4.11 to 3.4.13; Fast XML Parser 5.9.3 to 5.10.1; Linkify-it 5.0.1 to 5.0.2; Brace Expansion 1.x, 2.x, and 5.x lines constrained to their patched compatible releases; JS-YAML constrained to 4.3.1.
- Production audit result: 0 vulnerabilities after a clean `npm ci`.
- Complete dependency audit result: 0 vulnerabilities after a clean `npm ci`.
- Type-check result: passed with no errors.
- Lint result: passed with 0 errors and one pre-existing React hook warning.
- Unit-test result: 127 files passed, 1 skipped; 1,181 tests passed, 7 skipped.
- Production Next.js build: passed on the host and in both clean amd64 Docker builds.
- Runtime dependency probe: web and worker both load Next.js 16.2.12, Sharp 0.35.3, and libvips 8.18.3.
- Safe integration-test result: not run. No approved disposable or CloudSpace database connection is configured in this session. Brightside was not substituted.
- CloudSpace verification: pending and blocks deployment.
- Local validation image digests: web `sha256:9e28ecf0c2ba5ef7630bbadea5678d0e69fc66009b2bbc9e17eb23edf11df61c`; worker `sha256:3db877d8844b8f9d3e78404d281034e02d6f78c3c99611009a9179f46861aade`. These are local evidence, not ACR release digests.
- Release commit and ACR image digest: pending PR, pipeline, and CloudSpace gates.
- Previous web and worker rollback revisions: current live web `ca-vaultspace-web--poolfix`; prior web reactivation target `ca-vaultspace-web--hmac1`; worker `ca-vaultspace-worker--recov1`.
- Production quick-health result: healthy on the existing release after W0-2; no W0-1 deployment has occurred.
- Residual risks and accepted exceptions: W1-1 through W1-3 remain open. The current `SKIPPED` malware-scan behavior is accepted and unchanged. Database-backed integration and CloudSpace smoke verification remain mandatory before deployment.

## W0-2: Low-risk Azure operations hygiene

### Strawman

- Delete locks can create deployment friction if the pipeline replaces a resource instead of updating it in place.
- Deactivating every zero-traffic revision can remove an immediately warm rollback target and make a recovery slower.
- The current web revisions use the same application image, so revision cleanup reduces cost and running surface but does not remove a distinct vulnerable image from ACR.
- The simpler control is to apply `CanNotDelete` locks only to the four named stateful resources and deactivate only revisions receiving zero traffic, while retaining the newest prior revision as a documented reactivation target.

### Steelman

- PostgreSQL, Storage, Key Vault, and ACR currently have no resource locks. An accidental control-plane deletion would have substantially greater impact than the low-risk lock operation.
- The deployment workflow updates these resources and applications in place; no workflow deletion of the four stateful resources was found.
- Two healthy web revisions receive zero traffic but each keeps one running replica. Deactivation stops unnecessary old-code execution and cost without deleting the revision.
- Azure Container App revision deactivation is reversible. The newest prior revision can be reactivated if the current revision fails.

### Pre-Mortem

Assume the operations hygiene change caused an incident.

1. A lock blocks the deployment pipeline.
   - Detection: review the workflow for stateful resource deletion or replacement before creating locks; the next pipeline preflight must complete before traffic changes.
   - Rollback: remove only the blocking lock through an approved, explicitly scoped Azure command, then rerun the pipeline. No lock removal is part of this work item.
2. The active web revision is accidentally deactivated.
   - Detection: resolve the 100-percent traffic revision and verify quick health immediately before each deactivation command.
   - Rollback: reactivate the recorded revision and restore its traffic weight to 100 percent.
3. The designated rollback revision cannot be started.
   - Detection: retain its revision record and image reference, and do not delete the revision or image.
   - Rollback: reactivate the newest prior revision. If it is unhealthy, keep the current healthy revision at 100 percent and escalate rather than shifting traffic.
4. Worker cleanup stops asynchronous processing.
   - Detection: the sole worker revision is active but scaled to zero by design, so it is excluded from cleanup.
   - Rollback: not applicable because the worker revision is not changed.
5. A lock creates false assurance about data-plane operations.
   - Detection: document that Azure resource locks protect control-plane deletion, not application-level data deletion or secret misuse.
   - Rollback: not applicable to the limitation; keep existing application and backup controls in scope.

### Go/no-go

Proceed only if:

- The exact resource IDs are in `Munger subscription 1` and `rg-vaultspace-staging`.
- The lock type is `CanNotDelete`, not `ReadOnly`.
- The deployment workflow contains no deletion or replacement of the locked resources.
- The current web revision is healthy and receives 100 percent traffic.
- Only zero-traffic web revisions are deactivated.
- The newest prior web revision remains recorded as the rollback target and can be reactivated.
- The sole scaled-to-zero worker revision is not deactivated.

Decision: **GO for the four scoped `CanNotDelete` locks and zero-traffic web revision deactivation, subject to an immediate quick-health check.**

### W0-2 evidence record

- Locks before change: none.
- Stateful resources: `psql-vaultspace-staging`, `stvaultspacestaging`, `kv-vaultspace-staging`, `acrvaultspacestaging`.
- Current web revision: `ca-vaultspace-web--poolfix`, healthy, running, 100 percent traffic.
- Designated rollback revision: `ca-vaultspace-web--hmac1`, healthy before deactivation and retained for reactivation.
- Older zero-traffic revision: `ca-vaultspace-web--sec8e8d42c`.
- Worker revision: `ca-vaultspace-worker--recov1`, active and scaled to zero by design, excluded from cleanup.
- Locks after change: four resource-scoped `CanNotDelete` locks, one each on PostgreSQL, Storage, Key Vault, and ACR.
- Revisions after change: `ca-vaultspace-web--poolfix` remains active, healthy, running with one replica, and receives 100 percent traffic. `ca-vaultspace-web--hmac1` and `ca-vaultspace-web--sec8e8d42c` are inactive, stopped, and retained as revision records with zero replicas. `ca-vaultspace-worker--recov1` remains active and was not changed.
- Production quick-health after change: healthy, existing release `8e8d42c8130c620deaaabf6eb985efad170d673e`, no degraded capabilities. Homepage and login returned HTTP 200.
