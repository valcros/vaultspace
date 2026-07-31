# Password Reset Delivery Contract Version 1

## Purpose

`providerCorrelationSchemaVersion = 1` records that a password reset was created by the reviewed HMAC recovery and asynchronous delivery writer contract. It is a creation-time compatibility marker. It is not evidence that Azure Communication Services accepted or delivered an email.

Future ACS projection eligibility must independently require the persisted provider value `acs` and the complete provider acceptance tuple. Unmarked historical rows are never upgraded or backfilled into version 1.

Accepted ACS tuples for marked version 1 flows are also registered in `password_reset_provider_correlations`. The registry is durable correlation evidence. It does not claim that the provider delivered the message to the recipient.

## Writer contract

Version 1 writers must satisfy all of these conditions before superseding an older flow, creating a token or recovery row, enqueueing a job, or calling a provider:

1. Lock and re-read the global account, recipient state, active memberships, and active organizations.
2. For administrator issuance, also lock and re-read the initiating administrator account, membership, role, and organization.
3. Build `auditOrganizationIds` from the locked active membership snapshot.
4. Require 1 through 64 unique organization IDs. Each ID must be exact-trimmed ASCII matching `[A-Za-z0-9_-]{1,100}`.
5. Sort with JavaScript code-point order, which matches PostgreSQL `COLLATE "C"` for the allowed ASCII grammar.
6. Create the HMAC token, encrypted recovery row, version marker, supersession facts, and request audits in one transaction.
7. Send marked flows only through `password-reset.deliver`. A marked flow must never fall back to the legacy email job or synchronous delivery.

The warning threshold is more than 16 organizations. The hard limit is 64 and is system-wide for later registry and projector work. An account over the hard limit must have its membership data corrected before another reset is issued.

## Rejection behavior

An invalid locked scope creates no new reset flow, does not supersede a valid older flow, does not enqueue work, and does not call an email provider.

The anonymous endpoint returns its normal neutral response. The administrator endpoint returns HTTP 422. Tenant audit events may be written only to organizations established by the locked authoritative snapshot. If no trustworthy organization exists, the protected authentication-operations log contains only request ID, route type, reason code, and a cardinality bucket. It must not contain user IDs, email addresses, organization IDs, reset tokens, or provider identifiers.

## Provider acceptance durability

The provider operation ID is pinned in the protected recovery row. The acceptance reconciliation payload contains the flow ID, provider, provider message ID, acceptance timestamp, send fence, and request ID. The processor reloads the pinned operation ID and contract marker under lock before recording acceptance.

After provider acceptance, the worker starts the database write and bounded sensitive reconciliation enqueue independently:

- Database succeeds and enqueue succeeds: normal idempotent completion.
- Database succeeds and enqueue fails: do not resend. PostgreSQL is authoritative.
- Database fails and enqueue succeeds: reconciliation only. Do not resend.
- Both fail: leave the fenced `SENDING` state for stale-send reconciliation. The reconciler changes it to `ACCEPTANCE_UNKNOWN`, wipes the bearer recovery envelope, audits the outcome, and does not resend.

Only explicitly allowlisted transient Prisma errors receive bounded acceptance-persistence retries. Deterministic same-flow conflicts are terminal categorical outcomes. Raw provider message and operation identifiers remain only in protected token storage and the bounded sensitive acceptance reconciliation payload. Structured logs and tenant audit metadata use the flow ID as `correlationId` and do not contain those raw identifiers.

## Protected provider-correlation registry

The registry is append-only and is written by a database trigger when a marked version 1 flow records a complete ACS `PROVIDER_ACCEPTED` tuple. This trigger preserves compatibility during rolling deployment because both the prior version 1 worker and the current worker pass through the same database boundary.

The migration takes bounded locks on the token and recovery tables, installs the trigger first, and then backfills only rows that are currently `PROVIDER_ACCEPTED` and already satisfy the complete reviewed version 1 ACS contract. It does not mark, reinterpret, or register legacy rows. Marked complete non-ACS acceptances remain outside this ACS-only registry. Marked `PROVIDER_ACCEPTED` rows for any provider still require a complete provider tuple because incomplete marked acceptance is a preexisting version 1 delivery-contract anomaly. The migration aborts on incomplete marked acceptance, invalid ACS source state, divergent source state, or duplicate ACS provider identifiers.

The ordinary application role cannot select, insert, update, delete, truncate, reference, or trigger the registry directly. It may execute only `password_reset_provider_correlation_preflight_counts()`, which returns aggregate counts without provider identifiers. Installations that use a runtime role other than `vaultspace_app` must pass that exact role to the database privilege repair helper. The helper revokes obsolete non-owner function grants before granting only `EXECUTE` on the exact zero-argument aggregate function to the configured role. The posture function accepts that narrow grant only for its current non-owner session while rejecting grants to other roles, protected-name overloads, direct registry access, sensitive-function execution, and grant options. The Event Grid ingress role has no registry or registry-function access. Trigger functions run with a fixed `pg_catalog` search path and are not executable by `PUBLIC` or runtime roles.

Once registered, the tuple, hashed bearer token, and attribution fields are immutable. Foreign keys prevent deletion or operation-ID changes in the parent token and recovery rows. Lifecycle fields remain mutable: cancellation, redemption, supersession, or expiry after registration does not make the preserved acceptance evidence divergent. Repeating the exact database acceptance write is idempotent. Normal application retries recognize the already-recorded source tuple without mutating it. A missing registry row remains an anomaly and is never silently repaired by an unrelated no-op update. A different tuple is a terminal conflict, is not retried as a send, and produces a categorical authentication audit event in a separate transaction.

Registry rows are retained indefinitely in this chunk. No automated purge, retention exception, provider-inbox consumption, final-delivery projection, or final-delivery audit is enabled. Any later deletion policy requires a separately reviewed migration and operational runbook.

The registry activation time is a forward trust boundary, not a claim of complete historical ACS acceptance evidence. Rows that completed a later lifecycle transition before this migration, including pre-migration cancelled flows, are intentionally not backfilled. A future projector or report must use a cutover no earlier than successful registry activation and must not infer pre-cutover non-delivery from the absence of a registry row.

The exact catalog-rendering assertions in this chunk are certified by the PostgreSQL 15 migration and integration suite. VaultSpace remains generally compatible with PostgreSQL 15 or later, but operators using a newer major version must validate this migration and its zero-anomaly preflight in a disposable copy before production rollout until the security-posture CI matrix covers that major version.

## Deployment sequence

The ordinary staging deployment workflow cannot perform the first version 1 activation. Its pre-mutation boundary deliberately requires the currently serving web, worker, and configured password-reset reconciler images to already declare version 1, share one source revision, and match the live uncached health identity. This prevents a normal deployment or automatic rollback from crossing the compatibility boundary with a historical image.

The initial activation therefore requires a separately approved, operator-controlled runbook. That runbook must gate both issuance routes outside the application revision, drain and stop historical consumers, deploy the matched version 1 web and worker artifacts by verified digest, run the password-reset preflight, verify exclusive queue ownership and live health identity, and only then reopen issuance. After that activation, the ordinary staging workflow enforces version 1 for every forward deployment and rollback. The GitHub `staging` environment must retain its main-only custom deployment branch policy, because repository history contains older workflow definitions and Azure also trusts a main-branch OIDC subject.

1. Deploy the migration first. It adds the nullable marker and its database guard. Existing writers continue creating unmarked rows.
2. Keep provider-final projection disabled.
3. Gate both password-reset issuance routes before draining. Block `POST /api/auth/forgot-password` and `POST /api/users/*/reset-password` at the routing layer, verify the block from outside the service, and leave other application traffic available. Do not rely on a web revision or environment variable that an old writer does not understand.
4. Keep only the old worker revision active. Drain password-reset delivery jobs, acceptance-reconciliation jobs, active jobs, delayed retries, and recovery work. Run the reconciler until stale sends are terminal and no recovery is enqueueable. A momentary empty waiting queue is insufficient.
5. Keep issuance gated through the full one-hour token TTL unless every unmarked active delivery has reached an authoritative terminal state earlier. Require zero active, waiting, delayed, and failed-retry acceptance jobs that could be consumed by a different worker contract. The aggregate `unmarkedActiveDeliveryRows` must be zero.
6. Stop the old workers after the drain criteria remain stable. Do not start new workers while an old worker can still claim queue traffic.
7. Resolve every account reported by `overLimitActiveMembershipAccounts` by correcting its memberships. The preflight blocks writer activation until this aggregate is zero.
8. Deploy the new web and worker revisions while issuance remains gated. Wait for the new worker and web revision to become healthy, then run `npm run worker:password-reset-preflight` with the production runtime configuration.
9. Verify that no marked-contract anomaly or unmarked active delivery remains. Reopen both issuance routes only after the preflight succeeds and both new revisions are healthy.
10. Before any future provider-final projection promotion, additionally require zero post-cutover unmarked accepted ACS rows and complete the separately reviewed projection gates.

### Registry migration sequence

1. Keep provider-final projection disabled.
2. Apply the registry migration before deploying the worker revision that treats registry conflicts categorically. The migration trigger protects acceptances from the already deployed version 1 worker.
3. Require the migration backfill proof and all registry posture counts to be zero for missing, orphaned, divergent, invalid, ownership, trigger, constraint, index, ACL, and runtime-access anomalies.
4. Deploy matched web, worker, and reconciler artifacts through the existing digest-pinned deployment boundary.
5. Run the password-reset preflight. Its acceptance canary must add one registry row inside a transaction, and the forced rollback must restore the original aggregate counts.
6. Verify that normal password resets remain successful and that no raw provider message identifier appears in structured logs or authentication audit metadata.

### Registry migration timeout recovery

The registry migration is one PostgreSQL transaction with a 10-second lock timeout and a 120-second statement timeout. Either timeout rolls back the table, indexes, constraints, functions, triggers, grants, and backfill together. A timeout must not leave a partial registry installation.

If the migration times out:

1. Keep provider-final projection disabled and keep password-reset issuance gated.
2. Confirm the migration transaction rolled back. Verify that `password_reset_provider_correlations` and the new recovery unique constraint are both absent, or that the migration is fully installed with every preflight posture count at zero. Treat any other state as an incident.
3. Inspect database activity and lock waiters to identify the writer or long-running transaction that blocked the bounded table locks. Do not terminate an unrelated production session without separate operator approval.
4. Drain or stop the identified password-reset writers using the approved deployment controls, then wait for their transactions to finish.
5. If Prisma recorded the attempt as failed, use `prisma migrate resolve --rolled-back 20260731060000_add_password_reset_provider_correlation_registry` only after the database rollback has been verified.
6. Re-run the unchanged migration and its preflight. Do not edit an already deployed migration or increase the timeouts as the first response to lock contention.

## Mixed-version and rollback rules

The schema is backward compatible because the marker is nullable. An old writer can operate after the schema migration, but its rows remain unmarked and are ineligible for version 1 behavior. Do not run old and new workers concurrently against durable password-reset jobs. Issuance must remain gated whenever queue ownership moves between worker contracts.

To roll back application code, first gate both issuance routes. Keep only the version 1 worker active while marked delivery and acceptance jobs drain. Run reconciliation until every marked active delivery is terminal, no active or delayed queue work remains, and no send lease can later become stale. Stop the version 1 worker, deploy the old web and worker revisions with issuance still gated, verify their health and exclusive queue ownership, then reopen issuance. Leave the migrations, markers, and provider-correlation registry in place. Do not clear markers, rewrite or delete registry rows, backfill markers, or drop database guards during an application rollback.

Promotion to provider-final projection is a later reviewed change. This registry rollout does not consume provider inbox receipts, write provider-final projection fields, enable the projection feature flag, or create tenant final-delivery audit events.
