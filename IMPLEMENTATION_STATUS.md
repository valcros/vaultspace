# VaultSpace Implementation Status

> **Current Milestone:** Sprint 4 — Security hardening + accessibility largely complete
> **Last Updated:** 2026-04-26
> **MVP Status:** In progress — see MASTER_PLAN.md for the original sprint plan and BACKLOG.md for current outstanding work

## Current State

The application is **deployed and operational** on Azure Container Apps with all backend services healthy. The admin UI is substantially built with all pages wired to their APIs. CI pipeline passes (Lint, Type Check, Test, Build).

### Live Site

- **URL:** Azure Container Apps (East US)
- **Health:** Database, Cache, Storage all healthy
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
| Unit tests          | 515 passing (Vitest)                                                                            |
| Type check          | Passing (tsc --noEmit)                                                                          |
| ESLint              | Passing (no errors)                                                                             |
| Prettier            | Passing (all files formatted)                                                                   |
| CI (GitHub Actions) | Workflow covers lint, test, type-check, build, security, deployment-mode, and Docker validation |
| Integration tests   | Scaffolded (requires Docker for local; staging DB integration tests in `tests/integration/`)    |
| E2E tests           | 22 Playwright cases (`tests/e2e/`) plus accessibility scan (`tests/e2e/a11y.test.ts`)           |

### Security & Operational State (2026-04-26)

| Area                              | Status                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live URL                          | https://ca-vaultspace-web.victoriousglacier-374689f2.eastus.azurecontainerapps.io                                                                                                        |
| Health endpoint                   | `degraded: []` — DB, Redis, Storage all healthy; ACS email + scan capabilities reported correctly                                                                                        |
| RLS                               | Enforced. Application connects as `vaultspace_app` (NOSUPERUSER, NOBYPASSRLS); migrations and DDL run as `vaultspaceadmin` via separate `DATABASE_URL_ADMIN`. Audit: `npm run rls:audit` |
| Audit table immutability          | UPDATE and DELETE on `events` revoked from app role. Verified live: `permission denied for table events`                                                                                 |
| Worker queues                     | Single `general` worker drains all three BullMQ queues (high/normal/low); HTTP health endpoint on :3000 with Liveness/Readiness/Startup TCP probes attached                              |
| Container App env validation      | Pre-deploy script `scripts/validate-container-env.sh` blocks deploys with missing or plaintext-secret env vars                                                                           |
| SEC-001…016 (PERMISSION_MODEL.md) | 9 VERIFIED, 5 STRUCTURAL, 2 PARTIAL (SEC-010 + SEC-012 need E2E status-code assertions). Full table: `docs/SEC_AUDIT.md`                                                                 |
| WCAG 2.1 AA (public pages)        | 4/4 public pages pass after the `text-neutral-400` → `text-neutral-600` landing-footer fix. Authenticated-page scans pending login fixture. Full table: `docs/A11Y_AUDIT.md`             |

## What Remains for MVP

Sprint 4 closeout (in progress):

- Wire integration + a11y tests into CI (currently run on demand)
- Add login fixture for accessibility scans of authenticated surfaces
- Playwright E2E for SEC-010 (expired link → 410) and SEC-012 (password-protected link → 401 prompt)
- DMARC verification for `vaultspace.org` sender domain (NotStarted; needs DNS access)
- Stakeholder decision on F001 custom-domain scope (branding-only vs full org-aware routing)

Sprint 5 (not started):

- Demo experience + README polish + screenshots
- Tagged release (v0.1.0 → v1.0.0-beta), CHANGELOG, license header audit
- Full QA pass per `QA_TEST_PLAN.md`, cross-browser

## Custom Domain Status (F001)

- `resolveOrganizationFromHeaders()` exists in middleware
- Public branding endpoint works
- Full org-aware routing scope TBD (stakeholder decision)
