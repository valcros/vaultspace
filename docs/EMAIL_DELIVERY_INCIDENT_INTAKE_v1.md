# Email delivery incident intake, version 1

This document describes source code that is disabled by default. The existing ACS log view and Azure Monitor failure rule remain the active diagnostics until the gates below pass. This change does not activate Event Grid delivery ingestion.

## Data contract

The collector reads provider-final ACS statuses through the resource-context Logs Query API. It retains a provider message ID, recipient domain, keyed recipient fingerprint, categorical status and reason, SMTP codes, receiving server name, and event time. It never persists recipient addresses, email content, verification links, or raw provider failure text. Two recipients on the same ACS send receive separate incident keys. Repeated evidence is ignored; conflicting evidence for an existing key fails the collector run without overwriting the first record.

The SysOp incident queue is protected by platform operator access and `SYSOP_OVERVIEW_READ`. Acknowledgement additionally requires `SYSOP_SECURITY_MANAGE`, same-origin submission, and an atomic platform audit event. The table rejects updates to provider evidence, a second acknowledgement, deletes, and truncation. The view and collector are separately controlled by `EMAIL_INCIDENT_VIEW_ENABLED` and `EMAIL_INCIDENT_COLLECTOR_ENABLED`, both defaulting to false.

## Release gates

1. Review the exact migration, PostgreSQL 15 behavior, trigger, table owner, inherited default grants, and the runtime role's direct and indirect privileges. The ordinary `vaultspace_app` role must have no access to `email_delivery_incidents`.
2. Create a dedicated, non-inheriting collector database login with `SELECT` and `INSERT` on `email_delivery_incidents` only, no other application table rights, no `UPDATE`, `DELETE`, or `TRUNCATE`, no superuser or RLS bypass, and no `SET ROLE` path to a broader role. Store its connection URL in a protected secret. Do not use `DATABASE_URL_ADMIN` or the Event Grid ingress URL for the collector.
3. Create a scheduled collector job with its own managed identity. Give that identity Reader on the specific ACS CommunicationServices resource, not the Log Analytics workspace. Bind the resource ID, database URL, and a dedicated 32-byte fingerprint key through protected configuration. Keep the job disabled until the preflight and canaries pass.
4. Run the collector in a disposable environment with synthetic same-domain recipients, duplicate rows, conflicting rows, delayed log arrival, malformed rows, and a window-overflow case. Confirm no raw address, key, token, or provider prose enters logs or operator responses.
5. Dark deploy the web and worker image, validate database grants and managed identity, then run a bounded 30-day backfill. Confirm the October policy refusal and controlled `.test` bounce each create one incident. Check the protected operator page and acknowledgement audit as a signed-in platform operator.
6. Activate a five-minute schedule and add alerts for failed or missed collector runs. The default 72-hour overlap tolerates delayed ingestion and brief outages. A longer outage requires an explicit backfill within the Azure workspace's 30-day retention. Investigate any 1,001-row window overflow rather than silently truncating evidence.
7. Set and test an incident retention policy before calling this feature complete. Key rotation must preserve a stable fingerprint for records still within the deduplication horizon. Keep notifications out of personal mailboxes.

The current source branch does not create the scheduled job, its role or secrets, or a retention process. Do not set either feature flag to true in a live deployment yet. Event Grid shadow ingestion has separate security and replay gates documented in `acs-email-delivery-shadow-ingestion.md`.

## References

- VaultSpace `docs/ACS_DELIVERY_MONITORING.md` and `docs/acs-email-delivery-shadow-ingestion.md`.
- VaultSpace `prisma/schema.prisma`, the email incident migrations, collector source, and operator routes.
- [ACS email logs](https://learn.microsoft.com/en-us/azure/communication-services/concepts/analytics/logs/email-logs)
- [Azure resource-context log queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries)
