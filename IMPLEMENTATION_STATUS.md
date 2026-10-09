# VaultSpace Implementation Status

> **Current Milestone:** MVP launch packaging and Azure staging stabilization
> **Last Updated:** 2026-10-08
> **MVP Status:** Staging operational on the verified code release; launch blockers open. Outstanding work is tracked in `BACKLOG.md`. Historical release package: `docs/RELEASE_NOTES_2026-07-01.md`, `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md`, `MASTER_PLAN.md`.

## Snapshot (2026-10-08)

| Item               | Value                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live release       | `e7ee77d` (#193); fresh health, app digest, and four job image checks match the deployed code. Later documentation-only main commits are not implied deployed. |
| Health             | `status=healthy`, `mode=azure`, `degraded=[]`; database, cache and storage checks healthy                                                                      |
| API route handlers | 114 (`src/app/api/**/route.ts`)                                                                                                                                |
| Prisma migrations  | 67                                                                                                                                                             |
| Source size        | ~119k lines of TypeScript across 587 files in `src/`                                                                                                           |
| Open PRs / issues  | See GitHub for the live inventory; #185/#186/#190/#191 are superseded by #193.                                                                                 |
| Dependency audit   | 0 critical, 15 high, 6 moderate, 0 low on the `e7ee77d` lockfile; CI Security Scan passes; residual advisories tracked at P1.                                  |

## Azure verification and configuration cleanup (2026-10-08)

Read-only control-plane review completed: 11 checks Confirmed, 4 Corrected, 0
Unverifiable, with bounded coverage and caveats in
`docs/AZURE_OPERATIONAL_STATUS_2026-10-08.md`. Web/worker digests match the reviewed
build; all four scheduled jobs use the same worker digest. Password-reset
reconciliation is enabled on its scheduled job, even though the web health flag is
false. Log Analytics, resource-pressure alerts, and an action group exist. #192 also deployed two email failure rules; notification receipt remains separate evidence.

Follow-up #187 prepares corrected public web YAML, a non-deployable probe fragment, and alignment of environment, deployment, job, and agent documentation. Those cleanup changes await #187; this documentation PR does not apply them to Azure. Resource-specific posture and owner recommendations are tracked privately. Readiness, maintenance scheduling, remaining monitoring coverage, and residual dependency findings are separately reviewed work in `BACKLOG.md`.

## Shipped Since the July 21 Update

- **Verification email and critical advisories (#188):** deterministic UUID operation IDs at the ACS provider boundary; Next.js 16.3.8 and tinypool remediation, with successful deployment and signup verification.
- **Operational detection (#192):** generic preview authentication 401, safe invitation submission telemetry, and two deployed email failure rules with validated queries. Inbox and alert-notification receipt remain separate evidence.
- **Document serving and dependencies (#193):** generic download/thumbnail authentication 401, DOMPurify/Markdown/Sharp/source-map updates, real renderer integration coverage, remote Linux native-image checks, and eleven passing scoped live checks.

- **Scan gating (July):** #87 large files marked `SKIPPED` instead of quarantined; #88 one `isServable` gate on every serve/preview/export/index path; #89 serve the current version so rollback is effective; #90 viewer "unavailable" state (merged 2026-08-07).
- **Security hardening (August):** login and 2FA rate limiting (#101), search-snippet XSS (#102), SVG/XML preview neutralization (#104), local storage path traversal guard (#105), email HTML escaping (#107), self-host Compose hardening (#108).
- **Wave 1 auth refactor (W1-1, W1-2, #121 to #151):** room-scoped viewer authorization, centralized share-link admission, and login, session, organization and password-reset flows moved onto constrained bootstrap database functions with recorded deployment evidence.
- **MFA:** one-time challenge-bound MFA sessions (#159) and fail-closed enrollment (#160).
- **SysOp control plane (`/sysop`):** explicit platform-operator grants, audited operator access, tenant directory, org enable/disable and bulk disable, hourly operator-continuity check (#158, #163, #167).
- **User and room lifecycle:** scoped viewer invitations (#152), user lifecycle hardening (#153), room access editor (#154), enforced room lifecycle and closed-room immutability (#161, #162), viewer-to-admin promotion confirmation (#184).
- **Self-service onboarding:** email verification gate, durable verification delivery with a 5-minute reconciler (#169, #179), unscheduled stale verification token cleanup script (#168), workspace URL claim during setup (#171), selectable starter folder structures (#172).
- **Ops:** per-tenant backup/restore scripts, repository content sanitization and masked deploy metadata (#164, #165), monthly wildcard TLS renewal workflow.

Remaining scan residuals and other open work are in `BACKLOG.md`.

## Current State

The application is **deployed and operational** on Azure Container Apps staging with all deep health capabilities healthy. The admin UI, public viewer and SysOp surfaces are built and wired to their APIs. Treat the Azure environment as operational staging and beta-candidate infrastructure, not as a completed public MVP launch.

### Live Site

- **URL:** `https://www.vaultspace.org` (Azure staging on public VaultSpace domain)
- **Health:** `status=healthy`, `mode=azure`, `degraded=[]` on 2026-10-08
- **Container Apps:** web runs warm for public responsiveness; worker scales to zero when idle
- **Redis:** managed Redis on a BullMQ-supported version with encrypted protocol
- **Auth:** Scoped login/session and signup checks passed; password-reset provider acceptance was verified, while controlled-mailbox receipt remains unconfirmed
- **Demo:** Seed data with "Due Diligence Package" room, 3 folders, sample documents

## What's Done

### API Surface (114 route handlers)

- **Auth:** login, register, logout, forgot-password, reset-password
- **Rooms:** CRUD, templates, settings, analytics, audit, trash, admins, permissions, export
- **Documents:** CRUD, upload, preview, download, versions, restore, text indexing
- **Folders:** CRUD (list, create, get, update, delete)
- **Share Links:** CRUD (list, create, get, update, delete) + public access
- **Users:** list, get, delete, invite, role change, notification preferences
- **Groups:** CRUD + member management
- **Organization:** branding, activity log, public branding
- **Public Viewer:** access validation, document list, preview, download, logout
- **System:** health check, setup wizard, storage download

### UI Pages (All Built and Wired)

| Page                          | Status   | API Integration                                                      |
| ----------------------------- | -------- | -------------------------------------------------------------------- |
| Landing page                  | Complete | —                                                                    |
| Login                         | Complete | POST /api/auth/login                                                 |
| Registration                  | Complete | POST /api/auth/register                                              |
| Forgot/Reset Password         | Complete | POST /api/auth/forgot-password, reset-password                       |
| Setup Wizard                  | Complete | POST /api/setup                                                      |
| Rooms List                    | Complete | GET/POST/PATCH/DELETE /api/rooms                                     |
| Room Detail (Documents tab)   | Complete | Documents CRUD, folder navigation, upload, preview, download, delete |
| Room Detail (Members tab)     | Complete | GET/POST/DELETE /api/rooms/:id/admins                                |
| Room Detail (Share Links tab) | Complete | GET/POST/DELETE /api/rooms/:id/links                                 |
| Room Detail (Activity tab)    | Complete | GET /api/rooms/:id/audit                                             |
| Room Settings                 | Complete | GET/PATCH /api/rooms/:id, DELETE (with confirmation)                 |
| Room Analytics                | Complete | GET /api/rooms/:id/analytics (bar chart visualization)               |
| Room Audit Trail              | Complete | GET /api/rooms/:id/audit (pagination, CSV export)                    |
| Room Trash                    | Complete | GET /api/rooms/:id/trash, POST restore                               |
| Users Management              | Complete | GET /api/users, PATCH role, DELETE user, POST invite                 |
| Groups Management             | Complete | CRUD + manage members dialog                                         |
| Activity Log                  | Complete | GET /api/organization/activity (search, filter, CSV export)          |
| Settings Hub                  | Complete | Navigation to 4 subsections                                          |
| Organization Settings         | Complete | GET/PATCH branding + logo upload                                     |
| Notification Preferences      | Complete | GET/PATCH /api/users/me/notifications                                |
| Settings Activity Log         | Complete | GET /api/organization/activity (paginated, CSV export)               |
| Public Viewer (access gate)   | Complete | GET /api/view/:token/info, POST access                               |
| Public Viewer (document list) | Complete | GET /api/view/:token/documents                                       |
| Public Viewer (document view) | Complete | GET /api/view/:token/documents/:id/preview                           |

### Core Infrastructure

- **PermissionEngine** — 14-layer authorization (610 lines, 11 unit tests)
- **EventBus** — immutable audit trail (308 lines, 11 unit tests)
- **Rate Limiting** — per-IP, per-user (122 lines, 12 unit tests)
- **Session Management** — DB-backed, Redis-cached, cookie-based
- **Azure Guard** — runtime enforcement of Azure-only operation
- **Security Headers** — middleware-based, SAMEORIGIN for preview iframes, DENY for all else

### Providers (9 categories)

- Storage: Local, S3, Azure Blob
- Email: Console, SMTP, Azure Communication Services
- Cache: In-Memory, Redis
- Jobs: BullMQ
- Preview: Sharp (image thumbnails)
- OCR: Tesseract.js
- Scan: ClamAV, Passthrough
- Search: PostgreSQL FTS (stub)
- Encryption: (stub)

### Workers (5 processors)

- Email, Preview, Scan, Text extraction, Export

### Tests & CI

| Check               | Status                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Unit tests          | 1,574 passing in 177 files (Vitest, 2026-10-08), with 7 skipped tests in one opt-in live-Postgres search file |
| Type check          | Passing (tsc --noEmit)                                                                                        |
| ESLint              | Passing (no errors)                                                                                           |
| Prettier            | Passing (all files formatted)                                                                                 |
| CI (GitHub Actions) | Workflow covers lint, test, type-check, build, security, deployment-mode, and Docker validation               |
| Integration tests   | Scaffolded (requires Docker for local; staging DB integration tests in `tests/integration/`)                  |
| E2E tests           | 22 Playwright cases (`tests/e2e/`) plus accessibility scan (`tests/e2e/a11y.test.ts`)                         |

### Security & Operational State (2026-06-30, audit row updated 2026-10-08)

Current Azure review: `docs/AZURE_OPERATIONAL_STATUS_2026-10-08.md`.

| Area                              | Status                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live URL                          | `https://www.vaultspace.org`                                                                                                                                                                              |
| Health endpoint                   | Deep health returned healthy with all listed capabilities available on 2026-06-30                                                                                                                         |
| RLS                               | Enforced through `withOrgContext()` and covered by CI RLS integration tests. Application runtime uses the low-privilege app role, while migrations use admin credentials.                                 |
| Audit table immutability          | PostgreSQL trigger prevents raw SQL `UPDATE` and `DELETE` on `events`; integration coverage exists in `tests/integration/event-immutability.test.ts`.                                                     |
| Worker queues                     | Worker consumes BullMQ high, normal, and low queues. KEDA watches Redis wait lists for fresh jobs while the worker scales to zero when idle. Delayed retries are supplemented by a scheduled wake-up job. |
| Redis                             | Redis 6.0.14 warning resolved by migration to Azure Managed Redis Enterprise 7.4.                                                                                                                         |
| Email                             | Azure Communication Services email is wired for web and worker. Smoke scripts suppress repeated password reset, digest, and export emails unless explicitly enabled.                                      |
| Container App env validation      | Pre-deploy script `scripts/validate-container-env.sh` blocks deploys with missing or plaintext-secret env vars.                                                                                           |
| Dependency audit                  | Critical P0 findings closed by #188. Fresh full audit: 0 critical, 15 high, 6 moderate, 0 low. CI Security Scan passes; remaining findings are tracked at P1.                                             |
| SEC-001…016 (PERMISSION_MODEL.md) | `docs/SEC_AUDIT.md` reports 14 VERIFIED and 2 STRUCTURAL items, with 0 PARTIAL and 0 DEFERRED.                                                                                                            |
| WCAG 2.1 AA                       | Automated public and authenticated scans are wired in CI. Manual per-resource, document viewer, public viewer, keyboard, focus-order, and screen-reader review remains before MVP launch.                 |

## What Remains for MVP

The authoritative list is `BACKLOG.md`. Summary as of 2026-10-08:

- Critical dependency blocker closed by #188; remaining high/moderate findings are tracked at P1 with passing CI Security Scan.

Active launch blockers:

- Complete the manual MVP QA pass per `QA_TEST_PLAN.md`, including auth, room creation, upload, scan, preview, public viewer access, permissions, digest, export, trash/restore, and audit trail.
- Complete cross-browser and per-resource accessibility QA, especially the document viewer and public viewer link flow.
- Confirm Docker Compose self-hosting starts cleanly on an approved remote runner; no local Docker on the owner's workstation.
- Confirm the production/tag-based deployment path before any public beta promotion.

Passive monitoring and non-blocking follow-ups:

- Keep web `minReplicas=1` while VaultSpace is actively developed and public health/cold-start behavior matters.
- Keep worker `minReplicas=0` while KEDA wait-list scaling and the delayed waker continue succeeding.
- Keep monitoring delayed waker executions after image deployments and Redis secret rotations.
- Retain rollback resources only through the approved observation window; do not delete without fresh explicit cleanup approval.
- Track the Next.js `middleware.ts` to `proxy.ts` deprecation separately because renaming/removing the middleware file requires separate approval.
- Address existing React `act(...)` test warnings and PDF.js CDN worker use as cleanup items, not launch blockers unless the beta requires no-CDN operation.

## Custom Domain Status (F001) — Complete for MVP

- DNS: wildcard CNAME `*.vaultspace.org` routes to the Azure Container Apps ingress target
- TLS: wildcard cert `*.vaultspace.org` bound to Container App ingress
- Middleware: `src/middleware.ts` extracts the subdomain, sets `x-org-slug` header, and rewrites `/` to `/org/{slug}`
- Resolver: `src/lib/middleware/auth.ts:resolveOrganizationFromHeaders` looks the org up by slug or `customDomain`
- Public branding API: `/api/public/branding` returns the resolved org's branding for the requesting host
- Schema: `Organization.customDomain String? @unique` supports BYO domain when paired with operational onboarding

Live verification 2026-04-26: a seeded tenant subdomain returns the expected login redirect and public branding payload.

V1 expansion (BYO custom domain like `dataroom.client.com`) needs a per-tenant onboarding flow that adds the domain to the Container App ingress and provisions a managed cert. Not in MVP scope.

## DMARC for vaultspace.org — Effective

DMARC TXT record `_dmarc.vaultspace.org` resolves publicly as `v=DMARC1; p=quarantine; pct=100`. Combined with verified SPF and DKIM, downstream mail receivers (Gmail, Outlook, etc.) will apply the quarantine policy on alignment failures. The Azure Communication Services dashboard shows `DMARC: NotStarted` because ACS does not actively verify DMARC (only Domain, SPF, DKIM, DKIM2 appear in `verificationRecords`); the field is informational only.

Done (2026-08-09): the policy now carries `rua=mailto:security@vaultspace.org` for aggregate reports, and `vaultspace.org` was added to Exchange Online for inbound mail (MX + autodiscover + DKIM `selector1/2._domainkey`), coexisting with the ACS `azurecomm` sending records.
