# Email failure monitoring

This increment detects reported email submission, delivery-state persistence, and
reconciler failures. It does not establish inbox delivery or replace mailbox tests.

## Application signals

The admin document preview endpoint returns generic HTTP 401 JSON for recognized
authentication errors, preserving its existing frame headers. Unexpected failures
remain HTTP 500; missing or unauthorized documents remain HTTP 404.

The team invitation endpoint emits a structured `invitation-email` /
`provider_submission` event. `accepted` means the provider call returned successfully.
`failed_or_unknown` means submission failed or acceptance is uncertain. Invitation
creation retains its existing HTTP 201 response if sending fails. Operators must
not equate that response with email delivery or blindly resend an uncertain attempt.
These events contain no recipient, invitation URL, tenant identifier, or raw error.

## Alert configuration

`infrastructure/email-failure-alerts.json` defines two Azure Monitor scheduled-query
rules, disabled by default:

- **Submission/state:** terminal worker errors, verification rejection or uncertain
  acceptance, blocked delivery, password-reset recovery and acceptance-persistence
  problems, and invitation submission failure or uncertainty.
- **Reconciler:** explicitly logged verification or password-reset execution failure.

Both use a five-minute evaluation frequency and a fifteen-minute lookback. A positive
row count triggers a severity-2 alert. Normal retries, successful submissions,
cancelled flows, and superseded authoritative states do not trigger the rules.
Some persistence issues can trigger even when later reconciliation succeeds.

Only time, component, event, and outcome are projected. Customer identifiers and raw
log payloads are excluded from result rows and alert dimensions.

## Validate and deploy

Use an existing approved Log Analytics workspace and action group. Keep the populated
parameter file and operational output outside version control. Required parameters
are `location`, `workspaceResourceId`, `actionGroupResourceId`, and `workloadNames`.
Optional parameters are `namePrefix` and `enabled`.

Verify that the workspace contains only one intended workload for each selected app
or job name. The query uses `ContainerAppName_s` for apps and `ContainerJobName_s` for
jobs. It expects the `ContainerAppConsoleLogs_CL` table with JSON in `Log_s`. Do not
enable it in a workspace with a different schema without adapting and revalidating it.

Run the read-only validator with an explicit subscription, workspace customer UUID,
and each approved web, worker, and reconciler workload:

```sh
python3 scripts/validate-email-alerts.py \
  --subscription '<subscription-id>' \
  --workspace '<workspace-customer-id>' \
  --workload '<web-app>' \
  --workload '<worker-app>' \
  --workload '<verification-reconciler-job>' \
  --workload '<password-reset-reconciler-job>'
```

The validator runs the template's actual predicates in Azure's KQL engine against
non-ingested synthetic fixtures, tests empty windows, evaluates live queries, and
reports aggregate recent ingestion. It does not create alerts or send notifications.
Inspect ingestion evidence for the relevant workloads; an aggregate positive count
does not prove every workload is reporting.

Validate the ARM template and inspect an incremental deployment preview using the
approved parameter file. Review rule names to avoid overwriting unrelated rules.
After query and destination verification, deploy with `enabled=true`, then verify
the persisted rules and an authorized action-group test. Record notification receipt
separately from successful rule creation. Disabling these two rules is the rollback;
do not remove existing resource-pressure alerts.

## Evidence and limitations

The implementation review exercised the real KQL predicates against synthetic
failure, success, retry, cancellation, malformed-log, foreign-workload, and old-event
cases. Live schema checks and ARM validation are separate from enabled deployment.
The review board evaluated security, operational failure modes, and value/simplicity;
external review evidence is retained in the private task workspace.

These rules do not detect missing executions, worker startup failures before logging,
missing log ingestion, all unlogged state transitions, or mail rejected after provider
acceptance. Events ingested after the fifteen-minute event-time window can be missed.
The stateful rules can group multiple failures into an existing incident. They provide
service-level detection, not one notification per message.

Controlled mailbox checks must distinguish request acceptance, worker/provider
evidence, and actual inbox receipt. Use only an approved test organization and mailbox,
avoid replacing existing invitations or access, and do not redeem a password-reset
token as part of a send-only test. Never retain bearer links in logs or public evidence.

## Sources

- `src/app/api/rooms/[roomId]/documents/[documentId]/preview/route.ts`
- `src/app/api/users/invite/route.ts`
- `src/workers/processors/emailProcessor.ts`
- `src/workers/processors/emailVerificationDeliveryProcessor.ts`
- `src/workers/processors/passwordResetDeliveryProcessor.ts`
- `src/workers/emailVerificationReconciler.ts`
- `src/workers/passwordResetReconciler.ts`
- [Azure scheduled-query rule template reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/2023-12-01/scheduledqueryrules)
