# VaultSpace AI Query System: Phase 1 implementation review, revision 5

Date: 2026-10-17

Status: Phase 1 foundation deployed to staging. Phase 1 exit review remains open. Customer AI remains disabled.

## Objective and release boundary

The complete objective is a secure AI query system that answers questions from a user's current, authorized documents with verifiable citations. Phase 1 provides the trusted corpus and internal retrieval foundation. It does not provide a customer chat or search route. Organization and room AI switches default off. The current staging switches are enabled only for the named synthetic QA organizations and rooms.

Azure Foundry supplies embeddings through a dedicated VaultSpace staging resource and the worker's managed identity. The resource has local key authentication disabled. The provider boundary allows a later approved public or private backend without changing VaultSpace's authorization rules. Phase 2 must supply the actor's authoritative source allowlist, recheck authorization before releasing a result, and complete the room-wide eligibility gate.

## Deployed implementation

PR #228 merged as `e5bcef0585e29c3b0f2e5f486ff71951d7069292`. Exact-head CI run `39060605592`, main CI run `39061877791`, and staging deployment run `39063125241` passed. An independent agent approved the reviewed implementation commit `808e09368838a316cc8670404806f73f8dc2e732` before merge. The deployment used only Munger subscription 1, `041a67eb-fec8-41a4-9d70-c35863268cd6`. No Medau subscription was changed.

The staging migration `20261017010000_ai_corpus_foundation` applied. PostgreSQL has pgvector 0.8.2 and a valid 1,536-dimensional HNSW expression index. The worker and web use `vaultspace-embed@1`; the worker's system-assigned identity has resource-scoped Cognitive Services OpenAI User permission. A local-key request was rejected with HTTP 401. A managed-identity embedding probe returned a 1,536-dimensional vector, and the live worker indexed synthetic documents.

Sources bind a document, current version, checksum, model identity, pipeline revision, and page-aware chunks. The worker validates source eligibility before and after embedding. Database triggers and retrieval predicates invalidate or exclude stale, withdrawn, expired, failed-scan, closed-room, disabled-policy, and inactive-organization sources. Internal hybrid retrieval requires an explicit allowed-version set and repeats tenant and eligibility predicates in both lexical and vector lanes. Ordinary search is separate from this AI corpus.

## Synthetic QA evidence

| Gate                         | Result                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline fixture             | Two organizations, seven rooms, six users, nine CLEAN documents, six permission checks, and three link checks repeatedly verified.                                                                                                                                                                                                 |
| Supported corpus             | Eight of eight eligible current documents indexed across full, split-access, lifecycle, external, and isolation rooms. Eight READY sources and eight chunks at `vaultspace-embed@1`. The finance XLSX is unsupported in Phase 1 and is excluded from the eligible count.                                                           |
| Publication boundary         | Draft published-library view has no AI policy and no AI source.                                                                                                                                                                                                                                                                    |
| Retrieval relevance          | Golden probes Q001, Q003, and Q018 found the expected source. The split-access probe returned one allowed row and zero restricted rows. Cross-tenant, stale-model, and empty-allowlist probes each returned zero rows.                                                                                                             |
| Small-corpus client latency  | Twenty retrieval calls at concurrency five had p95 client duration 1,128 ms. This includes application and network overhead against the tiny staging fixture. Three first-pass embedding-plus-retrieval probes took 2,397, 1,784, and 1,693 ms.                                                                                    |
| Isolated vector feasibility  | On 5,000 synthetic 1,536-dimensional vectors, the HNSW index was used. Ten probes had exact-query p95 server time 22.76 ms and HNSW p95 server time 2.03 ms, with mean and minimum recall@8 of 1.0 and zero cross-tenant rows. This is a vector-only benchmark, not full application retrieval with joins and RLS at 5,000 chunks. |
| Policy rollback              | Disabling the synthetic lifecycle room purged its source and chunk synchronously while keeping its document. Re-enabling and reconciling restored 1/1 READY coverage. Organization-wide disable on the synthetic isolation organization behaved the same way.                                                                      |
| Concurrent policy/index race | A deterministic two-transaction drill held the indexer's lock order, then disabled the policy. The disable waited 7,282 ms, after which policy/source/chunk/document counts were 0/0/0/1. Re-enabling and reconciling restored coverage.                                                                                           |
| Backup and restore           | A clean CLI run backed up only the exact synthetic isolation organization: 48 tenant tables, two users, three blobs, and 23,106 blob bytes. Restore to a new empty local PostgreSQL database reproduced one AI source and one chunk with matching digest. All three blobs matched SHA-256 and byte size.                           |
| Provider and logging         | Azure Monitor showed 24 model requests and 469 token transactions in the observed two-hour window. A sample of 20 recent worker log lines contained no known fixture text, vector pattern, or credential pattern. The log sample is limited evidence, not a comprehensive retention audit.                                         |
| Focused local regression     | A new disposable local PostgreSQL database received all 80 migrations and RLS setup. Eight AI corpus integration tests and two worker retry tests passed. Reconciliation now preserves a current version's permanent failure instead of requeueing it indefinitely.                                                                |

The broader RLS suite on this local PostgreSQL 18.6 instance passed 130 of 135 tests. Five bootstrap password-reset and session tests failed. Those files were not changed in this follow-up, but the cause has not been established. The repository's PostgreSQL 15 CI run remains the required merge gate; this local result is not recorded as a full-suite pass.

The temporary one-IP staging database firewall rule used for QA was removed. The preexisting PostgreSQL `CanNotDelete` resource lock was restored and verified. The local restore PostgreSQL server was stopped after the drill. Ignored synthetic archives and local database files remain in workspace storage pending any separately approved cleanup.

## Review passes

| Pass            | Finding                                                                                                                            | Treatment                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strawman        | Reusing ordinary search or a single room-wide corpus would omit CLEAN-scan, version, and policy guarantees.                        | Keep a separate AI corpus with database-level invalidation, RLS, and current-source retrieval predicates.                                                                             |
| Steelman        | A default-off, managed-identity staging corpus makes the first release small enough to audit and allows provider replacement.      | Keep generation and customer routes for Phase 2, with permissions resolved by VaultSpace before model use.                                                                            |
| Premortem       | Stale versions, policy races, hidden sources, model revision drift, provider costs, or retry storms could create leaks or outages. | Recheck eligibility, serialize indexing with policy changes, filter every retrieval lane, bind model revisions, cap QA usage, and preserve permanent failures for operator diagnosis. |
| Security review | A queue payload or indexed chunk cannot be trusted as authorization.                                                               | Jobs carry IDs only; the database is the authority before and after embedding; customer access stays off.                                                                             |
| QA review       | A fast HNSW-only result may hide costly joins and RLS at scale. A small log scan may miss other disclosures.                       | Keep full-path representative-volume latency and broader telemetry review as explicit exit gates.                                                                                     |

## Open Phase 1 exit gates

1. Run representative-volume full hybrid retrieval with real authorization joins and RLS, measure p95 under concurrent load, and verify zero unauthorized rows. The 5,000-vector microbenchmark and eight-document staging run do not close this gate.
2. Complete independent code, security, and QA review of the follow-up reconciliation and QA change, followed by exact-head CI and staging deployment. The Phase 1 foundation itself was independently approved and deployed.
3. Record an operator acceptance decision for Phase 1 after the remaining evidence is in place. Do not enable a customer query route before Phase 2's actor authorization, citation, and response gates are complete.

## Operational notes

The synthetic QA scripts require exact staging identity checks and do not enable customer policies. `scripts/ai-query-phase1-qa.ts` supports status, enable, reconcile, room disable, and organization disable for named fixtures. `scripts/ai-query-phase1-retrieval-qa.ts` performs read-only retrieval tests. `scripts/ai-query-phase1-race-qa.py` intentionally disables the lifecycle fixture's AI policy and requires explicit synthetic staging confirmation; the operator must re-enable and reconcile afterward.

The backup/restore drill used local disposable databases because an isolated Azure restore database encountered an existing server-wide password-reset role prestate and could not replay an older migration. The failed Azure restore database contained no organizations and was removed. The successful local restore validates the archive, tenant rows, and blobs; it does not constitute a full Azure server disaster-recovery rehearsal. Production pgvector activation and index build remain separate change windows with their own measurement.

## References

- `docs/AI_QUERY_SYSTEM_PHASED_IMPLEMENTATION_PLAN_2026-10-17_v1.md`.
- `docs/AI_QUERY_PHASE0_ARCHITECTURE_DECISION_2026-10-17_v1.md`.
- `prisma/migrations/20261017010000_ai_corpus_foundation/migration.sql`.
- `src/lib/ai/`, `src/workers/processors/aiIndexProcessor.ts`, `tests/integration/ai-corpus.test.ts`.
- `scripts/benchmark-ai-query-pgvector.py` and the Phase 1 QA scripts.
- [PR #228](https://github.com/valcros/vaultspace/pull/228).
