# VaultSpace Implementation Status

> **Current Milestone:** MVP launch packaging and Azure staging stabilization
> **Last Updated:** 2026-07-21
> **MVP Status:** Staging operational, launch blocker review in progress. See `docs/RELEASE_NOTES_2026-07-01.md` and `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md` for the current release package, `MASTER_PLAN.md` for the original sprint plan, and `BACKLOG.md` for current outstanding work.

## Recent Security Hardening (2026-07-21)

A scan-gating security pass shipped to `main` (see `CHANGELOG.md` → Unreleased):

- **#87** — large files too big to scan are marked `SKIPPED` (allowed + flagged unscanned) instead of quarantined as infected; ClamAV parsing and `CLAMAV_MAX_SCAN_BYTES` validation hardened (fail-closed).
- **#88** — one `isServable` (CLEAN/SKIPPED) gate enforced at every serve / preview / thumbnail / export / index path, including worker-side re-checks against the DB-authoritative blob key. `INFECTED` / still-scanning versions and their derived assets can no longer be served or processed.
- **#89** — serve routes resolve the document's current version (`currentVersionId`), so a non-servable current version returns unavailable (admin `403` / viewer `404`) with no silent downgrade, and version rollback is effective on the serve side.

Open follow-up: **#90** (viewer "unavailable" UI state, reviewed, CI-green, pending merge). Tracked residuals (not INFECTED-leak / hidden-SKIPPED): CLEAN/INFECTED scan-worker side-effect isolation, `/api/search` legacy-row snippets, scanProcessor payload-key binding, ClamAV throw-in-callback. A one-time combined staging smoke should validate #89 + #90 together (upload a new version → document goes dark for a viewer during scan → returns on CLEAN → rollback → serve follows).

## Current State

The application is **deployed and operational** on Azure Container Apps staging with all deep health capabilities currently healthy. The admin UI and public viewer surfaces are substantially built and wired to their APIs. Local validation passes lint, type-check, build, test, and production dependency audit gates.

The latest release candidate has been deployed to Azure staging and tagged locally. Treat the current Azure environment as operational staging and beta-candidate infrastructure, not as a completed public MVP launch.

### Live Site

- **URL:** `https://www.vaultspace.org` (Azure staging on public VaultSpace domain)
- **Health:** `status=healthy`, `mode=azure`, `degraded=[]` during the July 1 release verification
- **Container Apps:** web runs warm for public responsiveness; worker scales to zero when idle
- **Redis:** managed Redis on a BullMQ-supported version with encrypted protocol
- **Auth:** Login, registration, password reset all functional
- **Demo:** Seed data with "Due Diligence Package" room, 3 folders, sample documents

## What's Done

### API Surface (61 route files)

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

| Check               | Status                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Unit tests          | 668 passing (Vitest), with 7 skipped tests in one opt-in live-Postgres search integration file  |
| Type check          | Passing (tsc --noEmit)                                                                          |
| ESLint              | Passing (no errors)                                                                             |
| Prettier            | Passing (all files formatted)                                                                   |
| CI (GitHub Actions) | Workflow covers lint, test, type-check, build, security, deployment-mode, and Docker validation |
| Integration tests   | Scaffolded (requires Docker for local; staging DB integration tests in `tests/integration/`)    |
| E2E tests           | 22 Playwright cases (`tests/e2e/`) plus accessibility scan (`tests/e2e/a11y.test.ts`)           |

### Security & Operational State (2026-06-30)

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
| Production dependency audit       | `npm audit --omit=dev` returned 0 vulnerabilities on 2026-06-30. Dev dependency audit is not claimed here.                                                                                                |
| SEC-001…016 (PERMISSION_MODEL.md) | `docs/SEC_AUDIT.md` reports 14 VERIFIED and 2 STRUCTURAL items, with 0 PARTIAL and 0 DEFERRED.                                                                                                            |
| WCAG 2.1 AA                       | Automated public and authenticated scans are wired in CI. Manual per-resource, document viewer, public viewer, keyboard, focus-order, and screen-reader review remains before MVP launch.                 |

## What Remains for MVP

Active launch blockers:

- Complete the manual MVP QA pass per `QA_TEST_PLAN.md`, including auth, room creation, upload, scan, preview, public viewer access, permissions, digest, export, trash/restore, and audit trail.
- Complete cross-browser and per-resource accessibility QA, especially the document viewer and public viewer link flow.
- Confirm Docker Compose self-hosting still starts cleanly.
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

Optional follow-up: add `rua=mailto:dmarc-reports@vaultspace.org` to the policy once an inbox is provisioned to receive aggregate reports.
