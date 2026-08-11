# VaultSpace W1-1 Deployment and Acceptance Evidence

Date: 2026-08-11 Pacific time

Evidence version: 1

Release status: **DEPLOYED AND ACCEPTANCE GREEN**

W1-1 status: **PENDING WRITTEN ADVISOR CLOSE-OUT**

Security freeze status: **ACTIVE**

P0-4 large-file and skipped-scan risk: **ACCEPTED AND UNCHANGED**

W1-2 and W1-3 implementation: **NOT STARTED**

## Decision summary

Request written Advisor close-out for W1-1 release
1502b3997bed57b279a5acb8f6e7eea791b9090e.

The approved room-scoped authorization and centralized link-policy slices, the bounded deployment
convergence correction, and the two CloudVault acceptance defect fixes are live. Exact-main CI,
the guarded deployment pipeline, immutable workload identity checks, the full synthetic CloudVault
matrix, and the authorized minimal Brightside read-only smoke are green.

This record does not itself close W1-1. W1-1 remains pending the required written Advisor
close-out. It does not authorize W1-2, W1-3, feature work, or a security-freeze lift. P0-4
fail-open malware-scan behavior remains an explicitly accepted residual risk and was not changed.

## Scope and operating boundaries

The deployment and verification stayed inside the approved boundaries:

- Azure work was limited to Munger subscription
  041a67eb-fec8-41a4-9d70-c35863268cd6 and the existing VaultSpace staging resources.
- The local Azure CLI context had drifted before the preflight. The guard stopped before any Azure
  resource query or mutation, the context was changed to Munger, and Munger was reverified.
- Every Azure resource command used the explicit Munger subscription argument.
- The Medau subscription was not queried or changed.
- Production validation used vaultspace.org only. vaultspace.cloud was not used.
- Health validation used quick, uncached identity health only. No deep=true request ran.
- CloudVault was the full-control test organization. Synthetic rooms, users, groups, grants,
  folders, documents, links, sessions, questions, signatures, and audit activity were used.
- Brightside validation was limited to the authenticated app shell, its previously known
  single-room route, logout, and a protected-route check after logout.
- No Brightside room-list discovery, room identifier, document name, metadata, preview, download,
  export, content, database row, or Key Vault customer secret was read or recorded.
- No credential, token, password, database URL, Key Vault value, customer detail, or protected
  content is present in this record or the acceptance script.
- No W1-2, W1-3, RLS enforcement, malware-scan policy, firewall, private-networking, HA, geo, CSP,
  HSTS, feature, or customer-communication change was made.
- All W0 and W1 Container App revisions and immutable images were retained.

## Governing analysis and approval record

The governing W1-1 design was merged before implementation and contains the mandatory Strawman,
Steelman, Pre-Mortem, rollback, and go/no-go record. The deployment convergence and both
CloudVault defect corrections also received versioned analysis before implementation.

The governing decisions were:

- Organization membership does not provide an org-wide VIEW baseline.
- Non-admin users require an applicable room or resource grant, group grant, or admitted link.
- Explicit NONE defeats non-admin allows.
- Org ADMIN retains organization-wide authority.
- Room ADMIN retains authority only inside the assigned room.
- Document-only and folder-only grants do not add the parent room to the general room list.
- Authorization occurs before totals and pagination.
- Revocation, group removal, link expiry, link deactivation, and membership deactivation default
  to deny.
- Link maxViews limits new admissions and does not terminate the session that consumed the final
  admission.
- Brightside remains a bounded read-only smoke target. CloudVault and synthetic fixtures carry
  the negative and destructive test matrix.

## Close-out analysis

### Strawman

- Brightside is still a single-room Beta. A large authorization change may solve future
  multi-room correctness before it changes the current customer posture.
- A green synthetic matrix can miss UI or integration behavior that depends on organic historical
  data.
- The acceptance runner has broad synthetic fixture coverage, but it uses an administrative
  database connection for fixture orchestration. It is not proof that W1-2 privilege separation is
  complete.
- One successful deployment does not eliminate future Azure control-plane convergence lag.
- Brightside smoke is intentionally shallow and cannot prove every customer workflow.

### Steelman

- The previous org VIEWER fallback violated the approved permission contract and allowed revoked
  or unassigned users to regain VIEW through membership.
- Filtering only the room list would have left direct resource and discovery-view bypasses. The
  deployed change applies authorization to room discovery, document discovery, dashboard,
  bookmarks, search, and direct resource paths.
- Central link admission and serve policy removes inconsistent endpoint handling for gates,
  scopes, expiry, revocation, maxViews, session reuse, Q&A, and signature behavior.
- The CloudVault matrix directly proved the two former acceptance blockers: document-level and
  ancestor-folder NONE are excluded before list total and pagination, and viewer logout
  soft-invalidates the session without rewriting immutable audit events.
- The minimal Brightside validation proved the deployed release preserved authenticated shell and
  known-room routing, completed logout, and enforced authentication on the protected route.
- Exact release, revision, image, health, traffic, worker, and job identity checks make the live
  state independently verifiable.

### Pre-Mortem

Assume W1-1 close-out is followed by an incident.

1. A VIEWER loses a room that was previously visible through membership alone.
   - Detection: CloudVault assigned-room, no-grant, direct-grant, group-grant, revocation, and
     admin matrix.
   - Rollback: restore retained W0 web revision 0000283 and W0 runnable digests. Do not restore the
     old org VIEWER fallback ad hoc.
2. A denied document remains discoverable through a list, total, search, bookmark, or dashboard.
   - Detection: explicit document NONE and inheritable folder NONE tests before totals and
     pagination, plus direct 404 checks and sibling-positive controls.
   - Rollback: restore W0, stop acceptance, and add the missing discovery route to the
     authorization-before-pagination inventory.
3. Viewer logout fails because deletion attempts to update immutable audit rows.
   - Detection: create audited viewer activity, log out, require inactive session, require
     subsequent serve 401, and verify retained events still reference the session.
   - Rollback: restore W0. Do not remove the audit immutability trigger or delete retained events.
4. Azure reports a healthy target while the old revision remains active.
   - Detection: bounded forward-path convergence retries re-query revision identity, runnable
     image, active revision count, traffic, quick health, and cache headers on every attempt.
   - Rollback: automatic pipeline recovery or the retained W0 revision. Strict sole-active and
     100-percent-traffic assertions remain mandatory.
5. Web and background workloads use a mixed release.
   - Detection: require the deployed worker runnable digest on the worker and all three scheduled
     jobs, plus the existing HMAC delivery and reconciler preflight gates.
   - Rollback: restore the coherent W0 worker and job digest set without hand-editing job images.
6. Evidence collection exposes private Brightside data.
   - Detection: record categorical pass or fail only, with no room IDs, names, document details,
     screenshots, or content.
   - Rollback: stop collection and escalate any actual disclosure. No such disclosure was
     observed.

### Go/no-go

**GO to request written W1-1 close-out.**

The Steelman justifies the control, the two CloudVault acceptance defects are fixed, the full
synthetic matrix and bounded Brightside smoke are green, the deployed identity is exact, and the
W0 rollback artifacts remain available. This is not a go decision for W1-2, W1-3, P0-4 changes,
feature work, or freeze lift.

## Implementation record

| PR   | Merge commit                             | Control boundary                                                                                |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| #121 | 791021849b71abbb5b5d53d3e358787432197513 | Governing W1-1, W1-2, and W1-3 design notes                                                     |
| #122 | 890e3c5292899af583b9a2d08c79266788f998ec | Room-scoped authorization, direct-resource guards, discovery filtering, and synthetic isolation |
| #123 | dbf01ec4c96a088e861d8f9ab678966eb8f1ab4a | Central link admission and serve policy                                                         |
| #124 | 7f33e4502836d742282153b80940cbf2b94f73a1 | Strict bounded forward web convergence retry                                                    |
| #125 | 1502b3997bed57b279a5acb8f6e7eea791b9090e | Document-list deny filtering and audited viewer-session soft invalidation                       |

The final release includes these reviewed corrections:

- nested-folder inheritance honors inheritable ancestor decisions;
- room list filtering occurs before count and pagination;
- room VIEW no longer grants visibility to a document resolved to NONE;
- document discovery views use document-level authorization;
- direct denied folder and document routes return 404;
- group membership is loaded by the authorization engine rather than trusted from caller input;
- link gates, expiry, activity, scope, permissions, maxViews, and admitted-session behavior are
  centralized;
- viewer logout soft-invalidates its session and leaves immutable audit rows untouched;
- the pipeline waits for Azure to converge to one active web revision while preserving every
  strict identity, digest, traffic, health, and cache assertion.

## Deployment chronology

The W1-1 rollout observed the approved stop, restore, fix, and redeploy discipline.

| Run                       | Result                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31522382038               | The initial dbf01ec deployment reached a healthy target but failed the immediate sole-active revision snapshot. Automatic recovery restored the W0 release.       |
| 31527448814               | The bounded convergence correction deployed 7f33e45 successfully. CloudVault acceptance then found document-list explicit-deny and audited viewer-logout defects. |
| W0 control-plane recovery | One bounded recovery restored W0 release 6971776 on web revision 0000283 and returned worker plus all three jobs to the coherent W0 worker digest.                |
| 31539368053               | The authorized single replacement dispatch deployed exact main SHA 1502b399 successfully. Automatic recovery was skipped.                                         |

No ancient W0 workflow attempt was used for the successful recovery. No second dispatch was made
after run 31539368053.

## Exact-main CI and deployment evidence

- Final main SHA: 1502b3997bed57b279a5acb8f6e7eea791b9090e.
- Exact-main CI run: 31536768270, success.
- Immutable image publication: success.
- Deployment workflow: Deploy to Staging, ID 251547585.
- Deployment run: 31539368053, success.
- Deployment event: one workflow_dispatch for the exact final SHA.
- Run interval: 2026-08-11 14:45:29 to 14:52:21 Pacific time.
- Full workflow duration: 6 minutes 52 seconds.
- Web mutation through strict final web convergence: approximately 1 minute 57 seconds.
- Observed customer-facing outage: none.
- Password-reset delivery-contract boundary: passed.
- Database migration step in the existing pipeline: passed.
- Worker update and readiness: passed.
- Password-reset reconciler update, validation, and real preflight: passed.
- Delayed-waker and invitation-lifecycle updates and template validation: passed.
- Quick health and deployment-mode validation: passed.
- Strict web revision, image, and traffic convergence: passed.
- Automatic recovery: skipped because the forward deployment succeeded.
- Workflow state after deployment: active.
- Ghost run 31428108038 remains risk-accepted as a stale, non-actionable record after its cancel API
  repeatedly returned HTTP 500. No real queued or active deploy blocked re-enablement.

## Final production identity

### Web

- Release: 1502b3997bed57b279a5acb8f6e7eea791b9090e.
- Revision: ca-vaultspace-web--0000284.
- State: active, healthy, provisioned, and running.
- Active revision count: one.
- Traffic: 100 percent to the active revision.
- Runnable platform digest:
  sha256:2e7d5d4748b9c70c5b10d4f5f6dd13af9f8540d90c5134962ed6e567e5000c6f.
- Degraded capabilities: none.

### Worker and jobs

- Active worker revision: ca-vaultspace-worker--0000267.
- Worker state: healthy, provisioned, and valid in the expected scale-to-zero posture.
- Runnable worker digest:
  sha256:afe783f5d3c648cd1effcbc18af24811f5b42decf26dd01e4a9bc20c5b1c8499.
- Delayed waker runnable digest: exact worker digest match.
- Invitation lifecycle runnable digest: exact worker digest match.
- Password-reset reconciler runnable digest: exact worker digest match.
- The three jobs and worker are coherent. No mixed W0 and W1 job image set remains.

### Retained W0 rollback

- W0 release: 69717769976d209687812b0301922cdce0f642f8.
- Retained web revision: ca-vaultspace-web--0000283.
- Retained revision state: inactive, healthy, and provisioned.
- W0 web runnable digest:
  sha256:3f1eab46892bd17e3d72f0165a97ab14ab0afa5121e6a7f5a8dede0cbf4603d2.
- W0 worker and job runnable digest:
  sha256:7c66163152c4a5073d3e1895c5a96c3d19523265a7bca5248a293af2ef7d22b3.
- W0 and W1 revisions and images were retained. No revision or image cleanup occurred.

## Quick production health evidence

The final recheck used only the quick endpoint with a unique identity query and explicit no-cache
request headers.

- Host: vaultspace.org.
- HTTP status: 200.
- Cache-Control: no-store, max-age=0.
- Status: healthy.
- Mode: azure.
- Release: 1502b3997bed57b279a5acb8f6e7eea791b9090e.
- Revision: ca-vaultspace-web--0000284.
- Degraded capabilities: none.
- Password-reset token write mode: hmac.
- Password-reset recovery configured: true.
- Password-reset writer and delivery contract: version 1.
- Deep health: not called.

## CloudVault acceptance evidence

The credential-free versioned operator runner
scripts/cloudvault-w1-1-acceptance-v1.cjs executed against vaultspace.org. It accepts the base URL,
exact CloudVault organization slug, and database connection only through process-local
environment variables. It generates ephemeral passwords and never prints credentials or secret
values. The committed copy adds a post-execution fail-fast safety guard that accepts only the
approved vaultspace.org hosts and an active organization whose exact name is CloudVault. The guard
does not change the executed matrix behavior.

All 21 live checks passed:

1. CloudVault login and session bootstrap.
2. Org VIEWER without a resource grant has no room VIEW baseline.
3. Two-room isolation and direct room grant.
4. Document NONE is excluded before list total and pagination; direct GET is 404; allowed sibling
   remains visible.
5. Inheritable parent-folder NONE excludes nested documents; direct GET is 404.
6. Direct grant revocation does not fall back to org membership.
7. Group grant allows access, and group removal immediately denies access.
8. Org ADMIN authority remains above resource ACL deny.
9. Room ADMIN authority remains above resource ACL deny only inside the assigned room.
10. Gate-free viewer session reuse occurs before redirect.
11. Viewer logout soft-invalidates the session, retains immutable audit references, rejects
    subsequent serve with 401, and permits a new admission when allowed.
12. Two concurrent final maxViews admissions produce exactly one success and one terminal denial,
    increment the counter once, and preserve the successful session.
13. Password, email allowlist, and NDA gates.
14. Expired and inactive links.
15. Link revocation invalidates an existing session.
16. Maximum viewer-session duration.
17. Folder scope includes descendants and excludes outside resources.
18. Document scope, VIEW without download, and Q&A scope.
19. DOWNLOAD capability validation without downloading document content.
20. Signature outside scope is rejected, and the in-scope signature action succeeds.
21. Authenticated user logout and protected-session invalidation.

The mandatory former-defect checks were green:

| Former defect                                                               | Result                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Room document list ignored document-level NONE                              | PASS: item and total excluded the document before pagination; direct route returned 404; allowed sibling remained listed |
| Nested document remained visible under inheritable folder NONE              | PASS: nested document was excluded and direct route returned 404                                                         |
| Viewer-link logout attempted an update through immutable Event foreign keys | PASS: logout soft-invalidated the session, subsequent serve returned 401, and audit events retained session references   |

Additional retained-state checks were green:

- one allowed scoped question was retained;
- in-scope signature state changes were recorded;
- audited viewer events were retained;
- authenticated logout audit was recorded;
- scoped document views were recorded.

Synthetic cleanup completed without destroying immutable events:

- synthetic users and memberships were deactivated;
- three synthetic rooms were closed;
- ten synthetic links were deactivated;
- synthetic viewer sessions were inactive;
- synthetic documents were soft-deleted;
- immutable audit events were retained.

No Brightside data was accessed during the CloudVault matrix.

## Brightside read-only smoke evidence

The user established the Brightside session in the existing vaultspace.org Chrome tab. Validation
then recorded categorical results only.

| Check                              | Result                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Authenticated app shell            | PASS: the app shell rendered, the main region was visible, and there was no redirect to login      |
| Previously known single-room route | PASS: direct navigation remained on the room route and the main region rendered                    |
| Logout                             | PASS: logout redirected to the authentication area and the room route was no longer visible        |
| Protected route after logout       | PASS: direct navigation to the same known route required authentication and did not serve the room |

The room route value was held only in browser-session memory for the bounded check. It is not
present in logs, this file, the operator script, commit data, or PR text. No room-list discovery,
document metadata, preview, download, export, content, screenshot, customer row, or Key Vault
customer secret was accessed or recorded. The Brightside account was left logged out.

## Local housekeeping

The explicitly authorized disposable local container
vaultspace-w1-cloudvault-defects-v1 was stopped and removed. It contained synthetic test data only.
No Azure resource, production database, credential file, application file, revision, or image was
removed.

## Rollback status

Rollback was not required for the final 1502b399 deployment or its CloudVault and Brightside
acceptance. The prior W0 web revision 0000283 and the coherent W0 web, worker, and job digests
remain recorded and retained.

If a post-close-out regression appears:

1. stop W1-1 acceptance activity;
2. restore the retained W0 web revision and coherent W0 worker and job digest set through the
   approved recovery path;
3. require exact W0 release identity, one active healthy web revision, 100-percent traffic, quick
   no-store health, and coherent worker and job digests;
4. do not reintroduce the removed org VIEWER fallback ad hoc;
5. keep the freeze active and return failure evidence to the Advisor.

## Residual risk and required next decision

- W1-1 is deployed and its approved acceptance matrix is green.
- W1-1 is not closed until the Advisor gives the written close-out stamp.
- W1-2 and W1-3 remain blocked until the authorized sequence and close-out gate permit them.
- The web runtime still has the W1-2 database privilege-separation risk.
- RLS completeness and canonical tenant-context work remain open for W1-3.
- P0-4 skipped or large-file malware-scan behavior remains an accepted residual risk and is
  unchanged.
- Private networking, firewall hardening, HA, geo, storage-key replacement, ACR admin replacement,
  CSP, HSTS, and customer communication remain outside this work.
- Silent hardening and the security freeze remain active.

## References

- Governing W1-1 design:
  docs/W1_1_ROOM_SCOPED_AUTHORIZATION_DESIGN_2026-08-10_v1.md
- Forward convergence analysis:
  docs/W1_1_FORWARD_WEB_CONVERGENCE_RETRY_2026-08-11_v1.md
- Document-list defect analysis:
  docs/W1_1_DOCUMENT_LIST_EXPLICIT_DENY_FIX_2026-08-11_v1.md
- Set-based document-list review:
  docs/W1_1_DOCUMENT_LIST_SET_BASED_REVIEW_2026-08-11_v1.md
- Viewer-logout defect analysis:
  docs/W1_1_VIEWER_LOGOUT_IMMUTABLE_AUDIT_FIX_2026-08-11_v1.md
- Wave 0 deployment evidence:
  docs/SECURITY_HARDENING_FREEZE_2026-08-10_DEPLOYMENT_v1.md
- CloudVault operator runner:
  scripts/cloudvault-w1-1-acceptance-v1.cjs
- PR #121: https://github.com/valcros/vaultspace/pull/121
- PR #122: https://github.com/valcros/vaultspace/pull/122
- PR #123: https://github.com/valcros/vaultspace/pull/123
- PR #124: https://github.com/valcros/vaultspace/pull/124
- PR #125: https://github.com/valcros/vaultspace/pull/125
- Exact-main CI run:
  https://github.com/valcros/vaultspace/actions/runs/31536768270
- Final deployment run:
  https://github.com/valcros/vaultspace/actions/runs/31539368053
