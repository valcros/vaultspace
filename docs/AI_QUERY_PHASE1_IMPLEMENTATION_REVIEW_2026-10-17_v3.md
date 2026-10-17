# VaultSpace AI Query System: Phase 1 implementation review, revision 3

Date: 2026-10-17

Status: In progress. Customer AI remains disabled.

Scope: trusted source index and internal retrieval foundation.

## Objective and current result

The complete objective is a secure AI query system that answers questions from a user's authorized, current documents with verifiable citations. Phase 1 establishes a separate AI corpus. It does not expose chat or search to customers. Both the organization-wide `organizations.aiEnabled` switch and a room's `ai_policies.enabled` record must be on. Both default off, so deployment alone sends no content to Foundry.

The implementation stores source identity and checksum, page-aware text chunks, 1,536-dimensional embeddings, job state, and metadata-only audit events in tenant-isolated tables. The AI worker resolves the document and version from the database, requires a current CLEAN version in an active independent room, checks the original file checksum, and repeats eligibility after embedding before committing the index. Normal search still accepts its existing scan policy; it is not the AI source authority.

The internal retrieval provider takes an explicit authorized version set from its caller, applies tenant, room, policy, current-version, scan, withdrawal, expiry, and active-state predicates in both lexical and vector lanes, and combines the results by reciprocal rank. Phase 2 must supply the authoritative actor-specific set and perform final authorization before any result reaches a user or model prompt. A pgvector HNSW index is activated separately in staging after migration. On deployments without pgvector, indexing and coverage work, but semantic retrieval is unavailable until an approved retrieval adapter is installed.

The embedding identity includes the configured deployment and an explicit revision. Coverage, reconciliation, and retrieval reject stale vectors from a prior model or pipeline revision. An inactive organization or disabled organization AI switch is excluded. Synchronous database triggers remove source derivatives when documents, versions, rooms, organizations, or AI policies become ineligible. PDF extraction falls back to OCR when a CLEAN PDF is unreadable by the text parser, without logging parser content.

## Operational sequence for synthetic staging QA

1. Merge and deploy the schema and worker changes to staging after CI and an independent security review. Do not enable customer policies.
2. Inspect the exact target staging database. Apply the baseline migration. Set `MIGRATION_DATABASE_URL` only in the process environment, then run `AI_VECTOR_INDEX_CONFIRM=staging npx tsx scripts/enable-ai-vector-index.ts` against that reviewed database. Confirm `vector` and the HNSW index exist.
3. Configure the staging worker with `AI_EMBEDDING_ENDPOINT`, `AI_EMBEDDING_DEPLOYMENT`, and `AI_EMBEDDING_REVISION`. Configure the staging web process with the same deployment and revision for accurate coverage reporting. The endpoint is the dedicated Foundry resource origin. Authentication uses the worker managed identity and no API key. Update the revision whenever the model behind the deployment changes. Keep these values out of tracked files.
4. Set `AI_QA_STAGING_DB_HOST` to the reviewed staging database host. Use `scripts/ai-query-phase1-qa.ts --status <organizationId> <roomId>` to inspect a synthetic room. With `AI_QA_AI_INDEX_APPLY=synthetic-staging-only`, use `--enable` and then `--reconcile` for each active synthetic QA room. `--enable` turns on the synthetic organization's AI switch and its room policy. `--disable-org` shuts down that organization's AI and purges its sources. The script checks the exact fixture organization and room names and slugs. Record index coverage, source and chunk counts, job errors, and model usage. The approved concentrated QA usage allowance is USD 150; review usage during the run.
5. Run the two-organization RLS, lifecycle, retry, duplicate, retrieval relevance, latency, backup/restore, and rollback gates. If any gate fails, leave the feature disabled and correct the issue before Phase 2.

The SysOp `GET /api/sysop/ai-index?organizationId=...&roomId=...` endpoint reports metadata-only coverage. It requires the existing platform operator overview capability. A room is ready only when every active in-scope document has a current CLEAN version and a complete index. Zero-document rooms are not ready.

## Rollback and retention

Disable the affected room policy or the organization's AI switch to purge indexed sources and chunks synchronously. Stop AI index jobs and remove staging worker embedding configuration if needed. Normal document serving and search continue. Document version changes, withdrawal, deletion, failed scans, room closure, and policy disable invalidate the AI source immediately through database triggers. Expiry by elapsed time is excluded in retrieval at query time and removed by reconciliation. Hard deletes cascade through foreign keys. Job audit records contain IDs and categorical codes, not text or vectors.

## Review passes

| Pass           | Finding                                                                                                                                                         | Action                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strawman       | Reusing `search_indexes` would be quick, but that index allows SKIPPED scans and is not bound to the current version and AI policy.                             | Separate AI source and chunk tables, with database and retrieval gates.                                                                              |
| Steelman       | Organization and room switches plus a current-version source record form a practical foundation for later model providers. The model never decides permissions. | Keep embedding and retrieval provider contracts separate; require an explicit allowed-source set.                                                    |
| Premortem      | A stale version, failed scan, disabled policy, tenant join error, model change, or missing vector extension could yield an unsafe or misleading answer.         | Synchronous invalidation, RLS and joins, model and pipeline identity, fail-closed coverage, staging pgvector gate, and no customer route in Phase 1. |
| Security audit | The queue can be replayed or forged and cannot be trusted as a source of policy. Provider errors could retain sensitive text in job logs.                       | ID-only jobs, database authority before and after embedding, categorical failures.                                                                   |
| QA audit       | Local plain PostgreSQL CI cannot install pgvector, and a synthetic microbenchmark is not an end-to-end retrieval test.                                          | Portable base schema, separate staging vector activation, and a required full-path staging benchmark before the phase gate.                          |

The first full CI run found that the new tables were absent from the fail-closed tenant backup classification. They are now classified for tenant backup and ordered for restore. The disposable PostgreSQL migration and RLS suite passed. A complete backup/restore drill remains an exit gate. The subsequent CI run passed type check, lint, security, RLS, unit tests, and build; end-to-end checks were still running when this revision was prepared.

## Outstanding Phase 1 exit evidence

- CI database migration and RLS integration results, including two-tenant isolation and lifecycle invalidation.
- Synthetic staging corpus coverage and reconciliation at 100%, with no unsupported active document silently considered ready.
- Retrieval relevance, pgvector index-plan, and p95 latency at representative volume and concurrent load.
- Live managed-identity embedding and key-disable verification, no ordinary log content, and measured usage within allowance.
- Backup/restore and timed rollback drill with normal document serving intact.
- Independent code/security/QA reviewer sign-off on the concrete implementation.

Do not mark Phase 1 complete or enable a customer AI route until these results are recorded and accepted.

## References

- `docs/AI_QUERY_SYSTEM_PHASED_IMPLEMENTATION_PLAN_2026-10-17_v1.md`.
- `docs/AI_QUERY_PHASE0_ARCHITECTURE_DECISION_2026-10-17_v1.md`.
- `prisma/migrations/20261017010000_ai_corpus_foundation/migration.sql`.
- `src/lib/ai/`, `src/workers/processors/aiIndexProcessor.ts`, and `tests/integration/ai-corpus.test.ts`.
- [pgvector expression indexing and hybrid search](https://github.com/pgvector/pgvector).
- [Microsoft Foundry embeddings REST API](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/embeddings).
