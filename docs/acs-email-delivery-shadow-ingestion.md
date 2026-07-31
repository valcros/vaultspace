# ACS email delivery shadow ingestion

This endpoint records authenticated Azure Communication Services email delivery reports in a durable, organization-independent inbox. Shadow ingestion does not update password-reset validity, delivery state, or tenant audit events.

## Dark deployment gate

1. Deploy the inbox migration to every application and worker environment.
2. Run migrations through a dedicated migration owner that is neither `vaultspace_app` nor the ingress login, and set its exact PostgreSQL role name in `EVENT_GRID_INBOX_EXPECTED_OWNER`. Create an isolated, non-inheriting, non-superuser ingress database login used only by `EVENT_GRID_INGRESS_DATABASE_URL`. Grant it `USAGE` on schema `public` and `SELECT`, `INSERT`, and `UPDATE` only on `provider_event_inbox`, without grant options or column-level grants. It must have no inherited role memberships, database or schema `CREATE`, sequence privileges, or privileges on any other application table or column. The ordinary `vaultspace_app` role must have no inbox privileges, must not own the inbox, and must have no direct or indirect role memberships that can be reached through `SET ROLE`. Run `npm run worker:provider-event-preflight` to verify ownership, effective privileges, table and column ACLs, denied tenant reads/deletes/object creation, evidence immutability, terminal conflict evidence, and valid processing transitions. Run the fail-closed RLS repair verification for `vaultspace_app` after any role or grant change.
3. Deploy the endpoint with `ACS_EVENT_GRID_INGESTION_ENABLED=false` and drain older application revisions.
4. Configure a single-tenant Entra application to accept v2 access tokens, add the `idtyp` optional access-token claim, and expose the `AzureEventGridSecureWebhookSubscriber` application role. Use the application client-ID GUID as the expected v2 audience. Pin the Microsoft.EventGrid application ID for the deployed Azure cloud. In a controlled canary, verify the literal `iss`, `aud`, `azp`, `idtyp=app`, `roles`, `tid`, and optional `oid` contract without recording the bearer token.
5. Configure a dedicated, versioned payload-fingerprint key ring. Retain retired keys through the maximum Event Grid retry and replay horizon.
6. Configure an encrypted Blob dead-letter container with managed-identity RBAC, access auditing, short retention, capacity/failure alerts, and explicit incident ownership. This is a privacy exception because dead letters contain the original ACS event, including email addresses.
7. Temporarily enable shadow ingestion only after steps 1 through 6 pass, then create the Event Grid subscription with Microsoft Entra webhook authentication, an exact `Microsoft.Communication.EmailDeliveryReportReceived` filter, and `maxEventsPerBatch=1`. The endpoint deliberately accepts exactly one notification event, so subscription validation cannot succeed while ingestion is disabled.
8. Disable authorization-header and request-body capture in the ingress proxy, WAF, platform request logging, Application Insights, and exception middleware.
9. Validate the authenticated subscription handshake, one real delivery receipt, exact duplicate delivery, a temporary 503 retry, conflict quarantine, and dead-letter creation/alerting. Return the feature flag to false if any canary fails.
10. Keep `ACS_EMAIL_DELIVERY_PROJECTION_ENABLED=false` until Chunk 4C and its real ACS message-ID correlation canary are approved.
11. Keep production ingestion disabled until a separately reviewed dead-letter recovery mechanism exists. Chunk 4B treats dead letters as access-controlled forensic evidence and does not provide replay.

## Response contract

- `200`: validation handshake, committed new receipt, exact duplicate, quarantined authenticated evidence, or durably recorded conflict.
- `400`: permanently invalid Event Grid schema, event type, source pair, or timestamp alias conflict.
- `401` or `403`: invalid token or unauthorized caller.
- `413` or `415`: over-limit or unsupported request framing.
- `503`: transient JWKS, configuration-key, or database failure. Event Grid should retry these responses.

The endpoint authenticates before reading the body, streams through a hard byte limit, commits the complete bounded batch before returning `200`, and never logs or stores the bearer token, raw body, sender, recipient, subject, validation URL, or provider status details.

## Dead-letter recovery boundary

Azure Communication Services system-topic events cannot be operator-published, and an operator token cannot satisfy the endpoint's pinned Microsoft.EventGrid caller identity. Therefore, operators must not submit dead-letter blobs to this webhook or weaken its caller pin. Chunk 4B has no replay claim. Until a separate recovery path with equivalent validation, PII controls, durable operator audit, and independent security review is implemented, preserve the encrypted object only for the approved retention window, diagnose the endpoint failure from safe fingerprints and error codes, and generate a fresh canary event after correction. Never paste dead-letter payloads into tickets, chat, logs, or command history.

## References

- https://learn.microsoft.com/en-us/azure/event-grid/secure-webhook-delivery
- https://learn.microsoft.com/en-us/azure/event-grid/end-point-validation-event-grid-events-schema
- https://learn.microsoft.com/en-us/azure/event-grid/delivery-and-retry
- https://learn.microsoft.com/en-us/azure/event-grid/communication-services-email-events
