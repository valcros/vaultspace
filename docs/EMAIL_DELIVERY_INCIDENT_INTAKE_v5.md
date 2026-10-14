# Email delivery incident intake, version 5

This version supersedes versions 1 through 4. The operator accepted the 180-day event and 30-day post-acknowledgement retention policy on 2026-10-13. The feature activation gates below still apply.

This document describes source code that is disabled by default. The existing ACS log view and Azure Monitor failure rule remain the active diagnostics until the gates below pass. This change does not activate Event Grid delivery ingestion.

## Data contract

The collector reads provider-final ACS statuses through the resource-context Logs Query API. It retains a provider message ID, recipient domain, keyed recipient fingerprint, categorical status and reason, SMTP codes, receiving server name, and event time. Incident IDs use UUIDs. It never persists recipient addresses, email content, verification links, or raw provider failure text. Two recipients on the same ACS send receive separate incident keys. Repeated evidence is ignored; conflicting evidence for an existing key fails the collector run without overwriting the first record. A malformed ACS row is counted and skipped so valid rows can be stored; the worker emits only a categorical degraded result with the count and exits unsuccessfully to trigger operations monitoring.

The SysOp incident queue is protected by platform operator access and `SYSOP_OVERVIEW_READ`. Acknowledgement additionally requires `SYSOP_SECURITY_MANAGE`, same-origin submission, and an atomic platform audit event. The table rejects updates to provider evidence, a second acknowledgement, deletes, and truncation. The view and collector are separately controlled by `EMAIL_INCIDENT_VIEW_ENABLED` and `EMAIL_INCIDENT_COLLECTOR_ENABLED`, both defaulting to false.

Retention uses a separate `purge_email_delivery_incidents_v1()` security-definer function. Each invocation removes at most 500 acknowledged rows whose event time is more than 180 days old and whose acknowledgement is more than 30 days old. Open incidents remain until reviewed. The function records the deleted count in the platform audit ledger in the same transaction. It is not executable by `PUBLIC` and this migration grants no maintenance role access. A separate `EMAIL_INCIDENT_RETENTION_ENABLED` flag defaults to false. Its runner needs a dedicated login with EXECUTE on that function only and no direct table rights. The operator accepted the 180-day event and 30-day acknowledgement policy on 2026-10-13; activation still requires the role, staging canary, and alert gates below.

Before every enabled retention run, the runner checks the exact configured role and owner, function ownership and security-definer status, schema privileges, membership and grant options, and absence of direct access to any public table. Missing or broader privileges fail the run before the purge function is called. Configure `EMAIL_INCIDENT_RETENTION_EXPECTED_DB_ROLE` and `EMAIL_INCIDENT_RETENTION_EXPECTED_OWNER` with the reviewed values.

## Release gates

1. Review the exact migration, PostgreSQL 15 behavior, trigger, table owner, inherited default grants, and the runtime role's direct and indirect privileges. The ordinary `vaultspace_app` role must have no access to `email_delivery_incidents`.
2. Create a dedicated, non-inheriting collector database login with `SELECT` and `INSERT` on `email_delivery_incidents` only, no other application table rights, no `UPDATE`, `DELETE`, or `TRUNCATE`, no superuser or RLS bypass, and no `SET ROLE` path to a broader role. Store its connection URL in a protected secret. Do not use `DATABASE_URL_ADMIN` or the Event Grid ingress URL for the collector.
3. Create a scheduled collector job with its own managed identity. Give that identity Reader on the specific ACS CommunicationServices resource, not the Log Analytics workspace. Bind the resource ID, database URL, and a dedicated 32-byte fingerprint key through protected configuration. Keep the job disabled until the preflight and canaries pass.
4. Run the collector in a disposable environment with synthetic same-domain recipients, duplicate rows, conflicting rows, delayed log arrival, malformed rows, and a window-overflow case. Confirm valid rows are saved when another row is malformed, the job reports a categorical failure, and no raw address, key, token, or provider prose enters logs or operator responses.
5. Dark deploy the web and worker image, validate database grants and managed identity, then run a bounded 30-day backfill. Confirm the October policy refusal and controlled `.test` bounce each create one incident. Check the protected operator page and acknowledgement audit as a signed-in platform operator.
6. Activate a five-minute schedule and add alerts for failed or missed collector runs. The default 72-hour overlap tolerates delayed ingestion and brief outages. A longer outage requires an explicit backfill within the Azure workspace's 30-day retention. Investigate any 1,001-row window overflow rather than silently truncating evidence.
7. Apply the accepted 180-day event and 30-day post-acknowledgement policy. Create a separate EXECUTE-only retention login and protected secret. Confirm it has no direct table rights, run a staging canary after the PostgreSQL 15 contract, then enable a daily schedule. Alert on failures and backlog. Key rotation must preserve a stable fingerprint for records still within the deduplication horizon. Keep notifications out of personal mailboxes.

The current source branch does not create the scheduled jobs, their roles or secrets, or activate retention. A disposable PostgreSQL 18 transaction validated the function with a role that had only schema USAGE and function EXECUTE. Direct DELETE failed, one eligible row was purged, other rows remained, and the audit count was written. PostgreSQL 15 validation passed in CI. The staging deployment workflow updates optional collector and retention job images only when their resource names are configured; it validates their commands and database secret references and restores their earlier pinned images on rollback. Do not set any incident feature flag to true in a live deployment until its respective gates pass. Event Grid shadow ingestion has separate security and replay gates documented in `acs-email-delivery-shadow-ingestion.md`.

## References

- VaultSpace `docs/ACS_DELIVERY_MONITORING.md` and `docs/acs-email-delivery-shadow-ingestion.md`.
- VaultSpace `prisma/schema.prisma`, the email incident migrations, collector source, and operator routes.
- [ACS email logs](https://learn.microsoft.com/en-us/azure/communication-services/concepts/analytics/logs/email-logs)
- [Azure resource-context log queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries)
