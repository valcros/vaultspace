# P1 Azure Operations Audit

## Scope

- Date: 2026-08-22 UTC
- Subscription: Munger subscription 1 (`041a67eb-fec8-41a4-9d70-c35863268cd6`)
- Resource group: `rg-vaultspace-staging`
- Explicit exclusion: no Medau subscription or resource was queried or changed.
- Brightside: no application data, organization data, room data, documents, users, or permissions were read or modified.

## Read-only verification

The deployment secret-reference audit queried Container Apps and Container Apps Jobs metadata only. No Key Vault secret value, connection string, token, credential, or private configuration value was retrieved or displayed.

It identified two worker configuration defects:

1. `ACS_CONNECTION_STRING` referenced a Container Apps local secret instead of a Key Vault-backed secret reference.
2. An unused `REDIS_PASSWORD` environment variable retained a second legacy credential path, while the worker uses `REDIS_URL`.

## Authorized remediation

At `2026-08-22T02:22Z`, the worker Container App was updated in place:

1. Its existing ACS secret reference was repointed to the existing staging Key Vault secret through the app's system-assigned managed identity.
2. The unused `REDIS_PASSWORD` environment binding was removed. The orphaned Container Apps secret was intentionally retained, not deleted.

Azure Resource Manager records these operations in the subscription Activity Log. The application-created revision is `ca-vaultspace-worker--0000306`; it reached `Healthy` and `RunningAtMaxScale` before release progression.
