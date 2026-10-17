# VaultSpace AI Query System: preliminary cost estimate

Date: 2026-10-17
Status: Planning estimate for stakeholder review, before Phase 1 implementation
Phase 0 approval: Stakeholder approved all Phase 0 items on 2026-10-17
Currency: USD public Azure retail rates, before negotiated discounts, tax, and support charges

## Decision summary

The selected Azure Foundry Data Zone Standard deployments have **no reserved-capacity or idle model charge**. They bill for tokens used. The existing VaultSpace web app, worker, PostgreSQL server, and Log Analytics workspace can support a synthetic pilot without a new fixed Azure service, subject to Phase 1 load testing.

| Cost                                  | Planning amount | Meaning                                                                                                                                                                                                |
| ------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One-time Azure setup and synthetic QA | **$60 to $160** | Illustrative 10,000-document initial index, 100 incremental worker hours, and 5,000 to 15,000 QA questions. Azure does not charge a separate model deployment setup fee for this pay-per-token choice. |
| Monthly, small pilot                  |   **about $25** | 2,000 questions, 2,000 newly indexed documents, 30 incremental worker hours.                                                                                                                           |
| Monthly, moderate use                 |  **about $110** | 10,000 questions, 10,000 newly indexed documents, 150 incremental worker hours.                                                                                                                        |
| Monthly, heavier use                  |  **about $550** | 50,000 questions, 50,000 newly indexed documents, 730 incremental worker hours. A database size or compute change could add about $90 per month or more.                                               |

These are **increases over the present VaultSpace staging baseline**, not estimates of its entire Azure bill. The first customer release could have a different mix of organizations, document sizes, questions, and security network controls. Reprice against the production subscription and actual pilot telemetry before a customer rollout.

## Price and usage assumptions

| Component                                |                   Rate used | Source and interpretation                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.4-mini` Data Zone Standard input  | $0.825 per 1 million tokens | East US `5.4 mini Inp Dz` retail meter.                                                                                                                                                                                      |
| `gpt-5.4-mini` Data Zone Standard output |  $4.95 per 1 million tokens | East US `5.4 mini Opt Dz` retail meter. Output includes any billable reasoning tokens.                                                                                                                                       |
| `text-embedding-3-small`                 | $0.022 per 1 million tokens | East US regional retail meter used as a provisional conservative rate. The retail API did not expose a separate Data Zone meter for this deployed embedding SKU. Confirm the actual billing meter from usage before rollout. |
| Extra Container Apps worker time         |      $0.108 per active hour | Current worker allocation of 1 vCPU and 2 GiB, using East US active meters of $0.000024 per vCPU-second and $0.000003 per GiB-second. The existing worker scales to zero.                                                    |
| Extra PostgreSQL storage                 |          $0.13 per GB-month | Central US Flexible Server storage retail meter. Billing follows provisioned storage, so a small index may consume current free capacity without immediate incremental charge.                                               |
| Extra analytics logs                     |       $2.30 per GB ingested | East US analytics ingestion meter. Charged conservatively here even if the shared account still has unused free grant. Raw prompts, answers, document text, and embeddings must stay out of ordinary logs.                   |

The question model assumes **6,000 input tokens and 800 output tokens per answer**, no cache discount, and one chat call. At the quoted rates that is **$0.00891 per question**, or about 0.9 cents. A larger 10,000-input and 1,000-output call is **$0.01320**, or 1.32 cents. Retrieval, history length, model retries, and reasoning output can change the token count; measure these in the synthetic pilot. Each newly indexed document is assumed to produce 3,000 embedding tokens. The proposed eight-chunk and output-token bounds from the architecture decision still require implementation and test.

## Monthly scenario calculation

| Incremental cost                   | Small pilot | Moderate use | Heavier use |
| ---------------------------------- | ----------: | -----------: | ----------: |
| Questions per month                |       2,000 |       10,000 |      50,000 |
| Chat tokens                        |      $17.82 |       $89.10 |     $445.50 |
| New documents indexed              |       2,000 |       10,000 |      50,000 |
| Embeddings                         |       $0.13 |        $0.66 |       $3.30 |
| Additional worker active hours     |          30 |          150 |         730 |
| Worker compute                     |       $3.24 |       $16.20 |      $78.84 |
| Additional storage allowance       |       $0.13 |        $0.65 |       $2.60 |
| Additional log ingestion allowance |       $1.15 |        $4.60 |      $23.00 |
| **Calculated monthly increase**    |  **$22.47** |  **$111.21** | **$553.24** |

The setup illustration is 10,000 documents at 3,000 embedding tokens each, costing about $0.66 for embedding, plus 100 extra worker hours at $10.80. Five thousand to fifteen thousand QA questions add about $44.55 to $133.65. This yields roughly $56 to $145 in cloud usage before small storage and log charges, rounded to **$60 to $160**. Implementation labor is separate.

## Capacity and design contingencies

Current staging PostgreSQL has 32 GB allocated and about 4.5 GB used. Over the preceding seven days, its mean CPU metric was about 4.6%, peak hourly CPU about 15.8%, and burst credits remained near their maximum. This supports the small synthetic pilot assumption but does not establish production vector-query headroom under concurrency. The PostgreSQL storage meter is about $4.16 per additional provisioned 32 GB. Moving from the current B2s compute meter to a two-vCore general-purpose Ddsv5 meter at current Central US retail rates would add **about $91 per month** before other changes.

If pgvector fails the Phase 1 quality, isolation, or load gates, a separate Azure AI Search service would add approximately **$74 per month for one Basic unit** or **$245 per month for one S1 unit** at East US retail rates. Those are alternatives, not part of the base estimate. Semantic Ranker, if selected, has separate query charges.

The base estimate does not include a private endpoint or a new private network topology. The East US Container Apps environment private-endpoint meter alone is $0.10 per hour, or about **$73 per month**; other network and private-link charges would be additional. Phase 1 must choose a production networking design before that cost can be quoted. The estimate also excludes dedicated/provisioned model throughput, a second region, high-availability PostgreSQL, a larger database tier, and a non-Azure model provider.

## Engineering effort, separate from Azure billing

Implementation labor is the main one-time investment. A preliminary planning allowance is **300 to 500 engineering hours for Phases 1 and 2**, covering the secure index and the first room-wide chat/search pilot, and **650 to 1,000 hours for the complete Phases 1 through 5 system**, including financial analysis, per-document authorization, testing, operations, and rollout. These are judgment ranges, not a fixed bid. At an illustrative loaded rate of $125 per hour, they correspond to **$37,500 to $62,500 for the pilot** and **$81,250 to $125,000 for the complete system**. The organization should substitute its actual staffing cost and refine this estimate after Phase 1 design and task breakdown.

## Cost controls before customer opt-in

1. Keep AI disabled by organization and room until the security and quality gates pass.
2. Enforce request, input-token, output-token, concurrency, and monthly organization budgets in VaultSpace. Azure budgets and alerts alone are not hard spending caps.
3. Log token usage, model version, error class, latency, and estimated cost without prompts or document text. Compare estimated cost to the Azure billing meter weekly during pilot.
4. Retain the Phase 0 **$25 per month staging target** while usage is light. For a concentrated synthetic evaluation month, approve a temporary **$150 Azure AI usage allowance**, with alerts at 50% and 80%, plus an application stop at the approved limit.
5. Reforecast after the first 1,000 synthetic questions and first representative indexing batch. Reprice for production before enabling customer content.

## Evidence limits and sources

The Azure Cost Management query for actual staging charges was throttled at the time of this estimate. These are public retail rates, not the subscription's negotiated invoice rates. Embedding Data Zone billing and actual token distributions must be checked against the first usage record. Current resource shape and seven-day PostgreSQL metrics were read from Munger subscription 1 on 2026-10-17. No Medau subscription was accessed or changed.

- [Microsoft: Azure OpenAI pricing and Retail Prices API lookup guidance](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq#where-do-i-access-pricing-information-for-legacy-models-which-are-no-longer-available-for-new-deployments).
- [Microsoft: Azure Retail Prices REST API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Queried 2026-10-17 with `armRegionName` `eastus` or `centralus`, the named products and SKUs above, and `priceType` `Consumption`.
- [Microsoft: Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/).
- [Microsoft: Data Zone Standard is pay per token](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/deployment-types).
- [Microsoft: Container Apps billing and shared free grants](https://learn.microsoft.com/en-us/azure/container-apps/billing).
- [Microsoft: PostgreSQL Flexible Server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/).
- [Microsoft: Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/).
- [Phase 0 architecture decision](AI_QUERY_PHASE0_ARCHITECTURE_DECISION_2026-10-17_v1.md) and [phased implementation plan](AI_QUERY_SYSTEM_PHASED_IMPLEMENTATION_PLAN_2026-10-17_v1.md).
