# VaultSpace AI Query System: Phase 0 architecture and privacy decision

Date: 2026-10-17
Decision status: Engineering baseline established; product/privacy acceptance required before customer content is sent to the model.
Scope: Munger subscription 1, VaultSpace staging, and future portable deployments.

## Decision

Build the first VaultSpace assistant against a dedicated Azure OpenAI resource in Microsoft Foundry. VaultSpace, not Foundry, will select and authorize document context. The initial chat deployment is `gpt-5.4-mini` version `2026-03-17` on `DataZoneStandard`; the embedding deployment is `text-embedding-3-small` version `1` on `DataZoneStandard`. Both are in the US data zone. The resource is in East US and is separate from the OpenClaw test account. Web and worker system-assigned managed identities have `Cognitive Services OpenAI User` on this resource only. Key-based local authentication is disabled on this new resource. No model configuration is connected to the application yet; application AI flags remain absent/off.

Use the stateless v1 chat-completions and embeddings endpoints with Microsoft Entra bearer tokens. Set `store: false` on chat requests. Do not use Foundry Files, Assistants threads, stored completions, fine-tuning, model-managed vector stores, external tools, or automatic provider fallback for the initial release. The application retains its own scoped conversation state only after the retention decision is accepted.

The application code will expose `ModelProvider`, `EmbeddingProvider`, and `RetrievalProvider` contracts. Azure adapters are first. A later approved public or private adapter must pass the same authorization, provider-conformance, data-handling, and QA gates. It cannot change source eligibility or widen a user's scope.

## Evidence from the live environment

| Item                      | Verified Phase 0 result                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription and resource | Dedicated staging resource created in `Munger subscription 1`, East US. No Medau resource was touched.                                                                                                                                                                                                                                                                                  |
| Deployments               | `vaultspace-chat`: `gpt-5.4-mini`, `DataZoneStandard`, capacity 10. `vaultspace-embed`: `text-embedding-3-small`, `DataZoneStandard`, capacity 5. Both provisioning states succeeded.                                                                                                                                                                                                   |
| Authentication            | Entra token smoke calls to the v1 chat and embeddings endpoints returned HTTP 200 using synthetic text. Embedding response contained 1,536 dimensions. Web and worker identities have resource-scoped inference role assignments; no application API key was created or stored.                                                                                                         |
| Key access                | `disableLocalAuth` is true on the new resource. Azure documents that data-plane propagation can lag the control-plane update, so Phase 1 must verify key rejection after propagation without exposing a key.                                                                                                                                                                            |
| PostgreSQL                | Staging Flexible Server is PostgreSQL 15 on `Standard_B2s`, 32 GB storage, with high availability disabled. `azure.extensions` was `pgcrypto`; it is now `pgcrypto,vector`. The extension was installed only in separate database `vaultspace_aiqa_bench`, not the application database.                                                                                                |
| Vector feasibility        | In the separate database, pgvector 0.8.2 indexed 5,000 synthetic 1,536-dimensional rows with HNSW. Ten probes gave 100% recall at 8, zero cross-tenant rows under an explicit tenant filter, and HNSW server execution p95 of 1.69 ms on the repeat run. The HNSW index appeared in the actual plans. Exact-search p95 was 25.18 ms. These are narrow, single-client synthetic results. |
| QA corpus                 | Two synthetic staging organizations, seven rooms, six non-login test identities, nine uploaded documents, ten versions, 18 frozen golden questions, and member/link permission baselines are present. All nine current versions scanned CLEAN. The second version in the lifecycle room is current.                                                                                     |

The vector result clears the Phase 0 feasibility threshold of recall at 8 at least 0.90, zero cross-tenant rows, and p95 server execution under 250 ms at 5,000 chunks. Phase 1 must still test realistic text, tenant distribution, concurrent traffic, RLS, index maintenance, and the entire retrieval path. The burstable staging SKU and current CPU credits must be included in that evaluation.

## Source scope and authorization

Phase 2 is one `INDEPENDENT` room per question. A member can use it only when the authoritative permission engine permits every in-scope active document, regardless of whether it has been indexed. A link viewer needs a valid room-wide link and current access to every such document. Independently, every in-scope current version must have passed the AI scan policy and been successfully indexed. If either condition fails, the room is not AI-ready. `SKIPPED`, pending, failed, and unsupported active documents block readiness. Closed rooms, archived/deleted/withdrawn/expired documents, and Company View rooms are excluded by policy. Later phases add per-document access, scoped links, and exact published Company View versions. This source resolver is shared by readiness, retrieval, context assembly, and final response checks.

The existing search route performs full-text search with a per-candidate `PermissionEngine` check but is not the AI source authority. It does not by itself establish current-version and withdrawal eligibility. The existing text worker handles plain text, PDF, and images; it does not extract XLSX. The actual `SearchIndex` schema has no vectors. Phase 1 therefore adds an AI source/chunk index and reconciliation rather than trusting the existing search rows. Phase 3 adds workbook-aware extraction and deterministic numerical calculations.

## Data flow and privacy controls

1. VaultSpace scans and extracts a current, eligible document. The chunk and embedding are sensitive derivatives of that document. Tenant isolation, encryption at rest, access controls, and deletion follow the source.
2. At query time VaultSpace authenticates the member or viewer session, resolves the authorized source set, and retrieves only bounded snippets. It checks eligibility before sending any text to the model.
3. Foundry receives the user's question and those bounded snippets for inference or embedding. The first release does not send an entire room corpus per request, create a model-hosted file store, or train a model.
4. VaultSpace validates the returned citations and rechecks permissions and source versions immediately before returning the answer. No response streaming is used in the pilot.
5. Ordinary logs retain metadata such as IDs, status, latency, token counts, model version, and correlation ID. They exclude raw questions, responses, snippets, document text, embeddings, API tokens, and keys.

Microsoft states that prompts, completions, and embeddings for Models sold by Azure are not used to train foundation models without customer permission, and that Data Zone deployment processing stays within the specified US zone. The privacy review must still consider Azure abuse monitoring and the precise contract that applies to this tenant and deployment. This decision does not assert that all prompt content is never retained by Microsoft under every safety process.

**Retention proposal for acceptance:** no persisted chat history in the first staging pilot until approved; after approval, default conversation expiry at 30 days, with an organization setting that may shorten it or disable history. External link viewers have session-bound history with no reuse after link/session expiry. Delete and retention jobs must remove application chat text and related references according to policy, with backup retention documented separately. Search/index derivatives follow document deletion and withdrawal rules. No raw prompt or answer is placed in telemetry.

## Operating policy and initial limits

- Keep AI off by default by organization and room. The new model deployment has no application traffic until Phase 1/2 code is reviewed and enabled for synthetic QA.
- Staging AI spend policy: target at most USD 25 per month for Phase 0 and Phase 1 synthetic use, with review at 50% and 80%. This is a management ceiling, not a hard Azure cap. The only Phase 0 model usage was the small smoke test. Before customer opt-in, implement application request and token bounds plus Azure cost alerts or a tested Foundry cost-control policy.
- Proposed pilot request bounds for Phase 2 review: 30 questions per member per day, 300 per organization per day, at most eight retrieved chunks, 8,000 input tokens of retrieved context, and 1,000 generated output tokens. Final bounds follow the golden-set and cost test results.
- A provider timeout, quota error, or unavailable model returns a bounded error. It does not route the question or snippets to another provider without explicit organization policy approval.
- The incident runbook must immediately disable the affected org/room AI flag for a suspected access leak, preserve metadata-only evidence, identify the cited source and policy revision, and block further model calls while the issue is investigated. Provider/identity compromise additionally requires revoking the resource-scoped role or disabling the deployment.

## Options considered and rejected for the first release

| Option                                                  | Phase 0 disposition                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse the OpenClaw test Azure OpenAI resource           | Rejected. It is a separate test dependency with a Global Standard chat deployment and unrelated ownership.                                                                                                                                  |
| Build or host a private LLM immediately                 | Deferred. It adds model operations, capacity, evaluation, and incident duties before the authorization and retrieval boundary is proven. The adapter contract preserves a private option.                                                   |
| Put all room content into one model-hosted vector store | Rejected for the first release. It would make current VaultSpace document permissions and lifecycle harder to enforce and audit.                                                                                                            |
| Azure AI Search as the initial retrieval engine         | Deferred. PostgreSQL pgvector passed a narrow feasibility test, and a retrieval interface allows a later change if scale or quality tests require it. Azure AI Search ACL features do not replace the current VaultSpace permission engine. |
| Global Standard deployment                              | Rejected for this baseline because it can process data outside the US zone. Data Zone Standard was available and provisioned successfully.                                                                                                  |

## Review record and outstanding acceptance

The design, privacy, and operations review checked tenant isolation, the model data path, current source versions, revocation timing, provider substitution, cost exposure, fixture isolation, and a first rollback path. The review found two implementation gates: the new resource still has public network access, although inference requires Entra authorization; and Azure key-disable propagation must be confirmed on the data plane. Network restriction or a private endpoint is a Phase 1/production design decision after Container Apps egress and cost review. No customer content has been sent to Foundry during Phase 0.

Architecture recommendation: **go to Phase 1 with synthetic data and disabled customer AI flags**. Product/privacy acceptance of the Foundry data path, US data zone, abuse-monitoring terms, and conversation retention is required before any customer document content is sent to the model. A code reviewer independent of this plan must audit implementation changes before release.

## References

Repository sources reviewed on 2026-10-17:

- `docs/AI_QUERY_SYSTEM_PHASED_IMPLEMENTATION_PLAN_2026-10-17_v1.md`.
- `src/lib/permissions/PermissionEngine.ts`, `src/lib/permissions/LinkPolicy.ts`, `src/lib/documents/scanGate.ts`.
- `src/app/api/search/route.ts`, `src/workers/processors/textProcessor.ts`, `prisma/schema.prisma`.
- `docs/CUSTOMER_FACING_ROADMAP_GROUP5_LIBRARY_INCREMENT_PLAN_2026-10-14_v1.md`.
- `qa/ai-query/fixture-manifest.json`, `qa/ai-query/golden-questions.json`, and `scripts/benchmark-ai-query-pgvector.py`.

External references:

- [Microsoft: Data, privacy, and security for Models sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy).
- [Microsoft: Foundry deployment types and processing locations](https://learn.microsoft.com/azure/ai-services/openai/how-to/deployment-types).
- [Microsoft: Azure OpenAI v1 chat API](https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/chat) and [embeddings API](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/embeddings).
- [Microsoft: Managed identity authentication for Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity).
- [Microsoft: Disable local authentication](https://learn.microsoft.com/en-us/azure/ai-services/disable-local-auth).
- [Microsoft: Use pgvector in Azure PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-use-pgvector) and [performance guidance](https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-optimize-performance-pgvector).
