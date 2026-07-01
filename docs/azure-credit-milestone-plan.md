# VaultSpace Azure Operations Notes

Last updated: 2026-07-01

This public repository does not track private Azure credit, tenant, subscription, budget, resource, or cross-project workload strategy. Operator-only details must stay in private runbooks outside the tracked VaultSpace source tree.

## Public Operating Principles

- Keep VaultSpace staging available while it is the active development environment.
- Optimize waste without disabling legitimate application services.
- Use budget alerts and monitoring as guardrails, not as source-controlled spending plans.
- Do not commit Azure subscription IDs, tenant IDs, exact resource group names, Key Vault names, secret names, access keys, connection strings, or image digests.
- Do not commit customer, cross-project, or unrelated Azure-environment details.
- Keep destructive cleanup actions behind explicit operator approval that names the target resource.
- Store exact deployment, rollback, and Azure credit milestone evidence in private operator records.

## Public Workload Categories

VaultSpace uses these Azure workload categories in staging:

| Category            | Public description                                      |
| ------------------- | ------------------------------------------------------- |
| Application hosting | Azure Container Apps for web and background processing  |
| Database            | Managed PostgreSQL                                      |
| Cache / queue state | Managed Redis for BullMQ-backed jobs                    |
| Container registry  | Azure Container Registry for application images         |
| Object storage      | Azure Storage for document assets                       |
| Secrets             | Azure Key Vault or operator-managed secret storage      |
| DNS / TLS           | Public domain routing and managed certificates          |
| Email               | Azure Communication Services                            |
| Monitoring          | Azure Monitor and Log Analytics                         |
| Scheduled execution | Container Apps scheduled job for delayed BullMQ wake-up |

## Cleanup Rules

Low-risk changes:

- Add or repair public-safe tags.
- Add budgets and alerting.
- Improve docs without exposing private environment details.
- Review stale artifacts and prepare cleanup candidates.

Actions requiring separate explicit approval:

- Delete any Azure resource.
- Delete snapshots, backups, archives, registry images, or rollback assets.
- Stop public services expected to remain available.
- Resize production-like database, compute, Redis, or storage resources.
- Change Azure CLI tenant/profile state on the operator machine.

## Worker And Redis Notes

VaultSpace workers are BullMQ consumers. KEDA list-based scaling can wake workers for fresh waiting jobs, but delayed BullMQ retries require a supplemental wake path or another delayed-job-aware design. The current public architecture records that the worker can scale to zero while a scheduled delayed-job wake-up path keeps delayed work from being stranded.

Redis must remain on a BullMQ-supported version. Exact endpoint names, secret references, and rollback resource names are intentionally omitted from this repository.

## Private Runbook Boundary

Keep these details out of git:

- Azure credit balances, milestone amounts, expiration dates, and budget recipients.
- Subscription, tenant, resource group, registry, Redis, Key Vault, and Container Apps names.
- Container image tags, image digests, revision names, job execution names, and build IDs.
- Secret names and values, including staging QA credentials.
- Cross-project Azure strategy or unrelated application environments.

Public status and release evidence belongs in:

- `docs/RELEASE_NOTES_2026-07-01.md`
- `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md`
- `CHANGELOG.md`
