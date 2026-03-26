# VaultSpace Master Plan — MVP to Production

> **Created:** 2026-03-25
> **Last Updated:** 2026-03-25 (post-sync with latest push)
> **Status:** Draft for Stakeholder Review
> **Prepared by:** Development Team

---

## Executive Summary

VaultSpace is an open-source, self-hosted Virtual Data Room (VDR) platform targeting M&A, investor relations, board governance, and compliance use cases. The project has comprehensive specifications (151 features across 4 release versions) and significant implementation progress.

**Current state:** The application is deployed and running on Azure Container Apps with a healthy database, cache, and storage layer. The backend API surface is ~95% complete (61 route files), authentication flows are functional, and core infrastructure (permissions engine, event bus, job queue, providers) is operational. The admin UI has substantial page scaffolding but several features remain unwired or incomplete.

**What remains for MVP:** Completing UI wiring for existing APIs, filling a small number of backend gaps, building integration/E2E test suites, establishing CI/CD, and production hardening.

This plan proposes **5 sprints** to reach MVP-complete, followed by stabilization and V1 planning.

---

## Site Validation (2026-03-25)

| Check                                 | Result                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| Landing page                          | Operational — branding, Sign In, Create Account links          |
| Health API (`/api/health?deep=true`)  | All healthy — database (582ms), cache (391ms), storage (354ms) |
| Login page (`/auth/login`)            | Fully built — email, password, remember me, forgot password    |
| Registration page (`/auth/register`)  | Fully built — name, email, password with confirmation          |
| Auth guard (`/rooms` unauthenticated) | Working — redirects to login                                   |
| Setup wizard (`/setup`)               | Built — multi-step (Org → Admin → Security → Complete)         |

**Deployed at:** Azure Container Apps (East US)

### Recent Changes (synced 2026-03-25)

Three commits landed during plan creation:

- **X-Frame-Options fix** — Security headers moved from static `next.config.js` to dynamic `middleware.ts`. Preview routes (`/documents/*/preview`) now use `SAMEORIGIN` to allow iframe embedding for the in-browser document viewer; all other routes remain `DENY` to prevent clickjacking.
- **Preview route hardening** — Both admin and viewer preview APIs consistently set `X-Frame-Options: SAMEORIGIN` on all response types (success, error, no-preview-available).
- **BACKLOG.md created** — Post-MVP enhancement tracker. First item: expanded document preview support (XLSX, PPTX, DOCX, CSV, Markdown, code syntax highlighting).

**Build status post-sync:** Type-check passes, lint passes, 34/34 tests passing.

---

## Implementation Inventory

### What Exists Today

#### Backend (61 API Routes)

- **Auth:** login, register, logout, forgot-password, reset-password
- **Rooms:** CRUD, templates, settings, analytics, audit, trash, admins, permissions, export
- **Documents:** CRUD, upload, preview, download, versions, restore, text indexing
- **Folders:** CRUD (list, create, get, update, delete)
- **Share Links:** CRUD (list, create, get, update, delete) + public access
- **Users:** list, get, delete, invite, notification preferences
- **Groups:** CRUD + member management
- **Organization:** branding, activity log, public branding
- **Public Viewer:** access validation, document list, preview, download, logout
- **System:** health check, setup wizard, storage download

#### UI Pages (Built)

- Landing page, auth pages (login, register, forgot/reset password)
- Admin layout with sidebar (Rooms, Users, Groups, Activity, Settings)
- Rooms list with search, create dialog, grid layout
- Room detail with document management
- Room settings, audit log, trash, analytics pages
- Users management with invite modal
- Groups management
- Activity log
- Settings hub, organization settings, notifications
- Setup wizard (multi-step)
- Public viewer (share token-based document access)

#### Core Infrastructure

- **PermissionEngine** — 14-layer authorization (610 lines, 11 unit tests)
- **EventBus** — immutable audit trail (308 lines, 11 unit tests)
- **Rate Limiting** — per-IP, per-user (122 lines, 12 unit tests)
- **Session Management** — DB-backed, Redis-cached, cookie-based
- **Azure Guard** — runtime enforcement of Azure-only operation

#### Providers (9 categories)

- Storage: Local, S3, Azure Blob
- Email: Console, SMTP, Azure Communication Services
- Cache: In-Memory, Redis
- Jobs: BullMQ
- Preview: Sharp (image thumbnails)
- OCR: Tesseract.js
- Scan: ClamAV, Passthrough
- Search: PostgreSQL FTS (stub)
- Encryption: (stub)

#### Workers (5 processors)

- Email, Preview, Scan, Text extraction, Export

#### Tests

- 34 unit tests passing (PermissionEngine, EventBus, Rate Limiting)
- Integration tests: scaffolded, not written
- E2E tests: scaffolded, not written

---

## MVP Feature Mapping (63 Features)

### Layer 0 — Foundation (9 features) ✅ COMPLETE

| ID   | Feature                           | Status                     |
| ---- | --------------------------------- | -------------------------- |
| F004 | Role separation: admin vs. viewer | ✅ Implemented             |
| F059 | SMTP-agnostic email               | ✅ Multi-provider          |
| F062 | Docker Compose deployment         | ✅ Configured              |
| F064 | PostgreSQL support                | ✅ Prisma + migrations     |
| F065 | S3-compatible storage             | ✅ S3 + Azure Blob + Local |
| F146 | CONTRIBUTING.md                   | ✅ Complete                |
| F147 | SECURITY.md                       | ✅ Complete                |
| F148 | ARCHITECTURE.md                   | ✅ Complete                |
| F149 | CODE_OF_CONDUCT.md                | ✅ Complete                |

### Layer 1 — Infrastructure (14 features) ✅ COMPLETE

| ID   | Feature                       | Status                       |
| ---- | ----------------------------- | ---------------------------- |
| F063 | Environment variable config   | ✅ 40+ env vars              |
| F066 | Reverse proxy ready           | ✅ Configured                |
| F068 | Automated DB migrations       | ✅ Prisma migrate            |
| F070 | Local disk storage adapter    | ✅ LocalStorageProvider      |
| F100 | Background job queue          | ✅ BullMQ                    |
| F102 | Internal event bus            | ✅ EventBus                  |
| F103 | Cache layer                   | ✅ Redis + In-Memory         |
| F141 | Centralized permission engine | ✅ 14-layer PermissionEngine |
| F142 | Multi-tenant org model        | ✅ organizationId scoping    |
| F152 | DATABASE_SCHEMA.md            | ✅ Complete                  |
| F153 | EVENT_MODEL.md                | ✅ Complete                  |
| F154 | PERMISSION_MODEL.md           | ✅ Complete                  |
| F155 | DEPLOYMENT.md                 | ✅ Complete                  |

### Layer 2 — Core Pipeline (6 features) ✅ COMPLETE

| ID   | Feature                           | Status              |
| ---- | --------------------------------- | ------------------- |
| F006 | Bulk upload with folder structure | ✅ API + UI         |
| F020 | User group management             | ✅ API + UI         |
| F101 | Preview/conversion pipeline       | ✅ Workers          |
| F104 | Rate limiting                     | ✅ Per-IP/user      |
| F105 | Session management                | ✅ DB-backed        |
| F137 | Backup/restore tooling            | ✅ Export processor |

### Layer 3 — Document Features (10 features) — MOSTLY COMPLETE

| ID   | Feature                                       | Status                           | Gap              |
| ---- | --------------------------------------------- | -------------------------------- | ---------------- |
| F007 | Drag-and-drop upload                          | ✅ UploadZone component          | —                |
| F008 | In-browser document viewer                    | ✅ DocumentViewer + react-pdf    | —                |
| F009 | Multi-format support                          | ✅ PDF, DOCX, XLSX, PPTX, images | —                |
| F010 | Document indexing/numbering                   | ✅ API route exists              | —                |
| F106 | File integrity (hash on upload)               | ✅ DocumentService               | —                |
| F107 | Virus/malware scanning                        | ✅ ClamAV + Passthrough          | —                |
| F108 | Room lifecycle (draft→active→archived→closed) | ✅ API                           | —                |
| F109 | Room templates                                | ✅ Templates API                 | —                |
| F110 | Document tagging/metadata                     | ⚠️ Needs validation              | Verify UI wiring |
| F132 | Basic OCR (Tesseract)                         | ✅ TesseractOCRProvider          | —                |

### Layer 4 — Access, Audit, Exports (10 features) — MOSTLY COMPLETE

| ID   | Feature                             | Status                    | Gap                                   |
| ---- | ----------------------------------- | ------------------------- | ------------------------------------- |
| F002 | Document version control            | ✅ Versions API + UI      | —                                     |
| F005 | Per-document/folder access controls | ✅ PermissionEngine       | —                                     |
| F014 | Download enable/disable             | ✅ API                    | Verify UI toggle                      |
| F016 | Email verification before access    | ✅ Link access API        | —                                     |
| F017 | Password-protected rooms/links      | ✅ Link access API        | —                                     |
| F019 | Per-user/group permission levels    | ✅ Permissions API        | —                                     |
| F025 | Audit trail                         | ✅ EventBus + audit pages | —                                     |
| F113 | Archive/export room as ZIP          | ✅ Export processor       | —                                     |
| F114 | Trash/soft delete with recovery     | ⚠️ Partial                | Verify folder delete works end-to-end |
| F116 | Granular link permissions           | ⚠️ Partial                | Verify UI for link create/edit/delete |

### Layer 5 — User-Facing (9 features) — NEEDS WORK

| ID   | Feature                                | Status                   | Gap                                                         |
| ---- | -------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| F001 | Custom domain support                  | ⚠️ Partial               | Only public branding lookup; full routing TBD               |
| F003 | Email notifications on view/update     | ⚠️ Backend only          | Verify email delivery end-to-end                            |
| F033 | Branded viewer (no 3rd-party branding) | ⚠️ Partial               | Public viewer exists; branding integration needs validation |
| F034 | Mobile-responsive viewer               | ⚠️ Needs testing         | Responsive CSS exists; needs QA on devices                  |
| F035 | No account required for viewers        | ✅ Share token access    | —                                                           |
| F039 | Multi-admin support                    | ✅ Room admins API + UI  | —                                                           |
| F121 | Room activity summary dashboard        | ⚠️ Page exists           | Verify data display and charts                              |
| F124 | Breadcrumb navigation                  | ✅ Breadcrumbs component | —                                                           |
| F130 | Configurable room settings             | ⚠️ Page exists           | Verify settings save correctly                              |

### Layer 6 — Admin & Onboarding (6 features) — NEEDS WORK

| ID   | Feature                         | Status                   | Gap                                     |
| ---- | ------------------------------- | ------------------------ | --------------------------------------- |
| F040 | Admin activity log              | ⚠️ Page exists           | Verify data loads and filters work      |
| F043 | Notification preferences        | ⚠️ Page exists           | Verify preferences save and are honored |
| F044 | Team invite and role assignment | ⚠️ UI partially wired    | Complete invite flow end-to-end         |
| F052 | GDPR data handling/deletion     | ✅ gdpr-export.ts script | —                                       |
| F128 | Admin setup wizard              | ⚠️ Page exists           | Verify full flow works end-to-end       |
| F143 | Demo seed data                  | ✅ prisma/seed.ts        | —                                       |

---

## Sprint Plan

### Sprint 1: "Wire It Up" — UI Completion & Backend Gap Fill ✅ COMPLETE

**Goal:** Every MVP feature has a working UI connected to its API.
**Completed:** 2026-03-25

#### 1.1 Backend Gap Fill

- [x] Fix X-Frame-Options blocking document preview iframe
- [x] Folder delete/rename API verified (code audit: handlers wired with confirmation dialogs)
- [x] Share link create/edit/delete APIs verified (code audit: full CRUD in room detail)
- [x] Room member add/remove verified (code audit: admin management wired)
- [x] No broken API routes discovered

#### 1.2 UI Wiring

- [x] Room detail: document preview, download, delete, restore — all wired
- [x] Room detail: folder create, navigate, delete — all wired
- [x] Room detail: share link create, copy URL, delete — all wired
- [x] Room detail: member add (by email), remove — all wired
- [x] Room settings: name, description, watermark, downloads, NDA, archive, delete — all wired
- [x] Room analytics: summary cards + bar chart visualization — wired
- [x] Room audit: event log with pagination and CSV export — wired
- [x] Room trash: restore documents — wired
- [x] Users page: invite flow + change role + remove user — wired
- [x] Groups page: create, edit, manage members, delete — wired
- [x] Activity log: search, filter, CSV export — wired
- [x] Notification preferences: toggle switches + save — wired
- [x] Org settings: name, branding color, favicon, logo upload — wired

#### 1.3 Setup Wizard & Auth

- [x] Setup wizard: multi-step flow verified (org → admin → security → complete)
- [x] Auth pages: login, register, forgot-password, reset-password — all complete
- [x] Auth guard: unauthenticated requests redirect to login

#### 1.4 Browser Validation (live site)

- [x] Login with demo credentials — success
- [x] Rooms dashboard — rooms grid, search, create, archive, delete
- [x] Room detail — folders, documents, 4 tabs, upload zone
- [x] Users page — 4 users, roles, avatars, action menus
- [x] Groups page — empty state with create button
- [x] Activity log — empty state with export and filters
- [x] Settings hub — 4 sections navigable

#### 1.5 CI Pipeline

- [x] First fully green CI run achieved
- [x] Prettier formatting compliance fixed for all files
- [x] ESLint curly brace compliance fixed

---

### Sprint 2: "Trust But Verify" — Testing & Quality ✅ COMPLETE

**Goal:** Automated test coverage for all critical paths.
**Completed:** 2026-03-26

#### 2.1 Unit Test Expansion (74 tests total)

- [x] RoomService: create, getById, list with pagination/filtering/search (12 tests)
- [x] GroupService: create validation, auth, duplicates, list (7 tests)
- [x] DocumentService: upload, validation, SHA-256, virus scan job, list (9 tests)
- [x] PermissionEngine security: SEC-001, 006, 007, 010, 011, 013 + boundaries (12 tests)

#### 2.2 E2E Tests (22 test cases)

- [x] Auth flows: login, register, forgot-password, invalid credentials, redirect
- [x] Rooms: dashboard, detail, folder navigation, members tab, links tab, settings
- [x] API: health, deep health, login, unauthenticated 401, security headers

#### 2.3 Integration Tests (existing)

- [x] Database CRUD and unique constraints (6 tests)
- [x] RLS cross-tenant isolation (17 tests)

#### Sprint 2 Results

- **Unit tests:** 34 → 74 (117% increase)
- **E2E tests:** 5 → 22 (340% increase)
- **CI:** 4 consecutive green runs

---

### Sprint 3: "Ship It Right" — CI/CD & DevOps ✅ COMPLETE

**Goal:** Automated build, test, and deploy pipeline.
**Completed:** 2026-03-26

#### 3.1 CI Pipeline (already existed, enhanced)

- [x] Build verification (TypeScript, ESLint, Prettier) — was working
- [x] Unit test execution on every PR — 74 tests running
- [x] Security scanning — added npm audit job to ci.yml

#### 3.2 CD Pipeline (new)

- [x] Staging deployment on merge to main — deploy-staging.yml created
- [x] Database migration automation — prisma migrate deploy in pipeline
- [x] Container image build and push to ACR — web + worker images
- [x] Health check validation post-deploy — curl /api/health in pipeline
- [ ] Production deployment — deferred (tag-based, future sprint)

#### 3.3 Pending (requires stakeholder action)

- [ ] Configure GitHub secrets: AZURE_CREDENTIALS, ACR_USERNAME, ACR_PASSWORD, DATABASE_URL
- [ ] Create GitHub environment "staging" with protection rules

---

### Sprint 4: "Harden & Polish" — Production Readiness (IN PROGRESS)

**Goal:** Security hardening, performance, and UX polish.

#### 4.1 Security (already in place)

- [x] X-Frame-Options: SAMEORIGIN for preview, DENY for rest
- [x] Security headers in middleware (CSP, nosniff, XSS protection, referrer policy)
- [x] Session: HttpOnly, Secure, SameSite=Lax cookies
- [x] Password hashing: bcrypt 12 rounds
- [x] Cross-tenant: 404 not 403 for existence prevention
- [x] Rate limiting: per-IP, per-user
- [x] npm audit security scan in CI
- [ ] RLS policies deployed and validated in staging (requires Azure access)
- [ ] ClamAV virus scanning validated end-to-end (requires Azure worker)

#### 4.2 UX (already in place)

- [x] Loading states: skeleton components on all data-fetching pages
- [x] Empty states: helpful messages on rooms, users, groups, activity
- [x] Error handling: API errors surfaced to user
- [x] Responsive layout: sidebar collapses on mobile
- [ ] Toast notifications: replace 25 alert()/confirm() calls (follow-up task)
- [ ] Accessibility audit: WCAG 2.1 AA (follow-up task)

#### 4.4 Custom Domain (F001)

- [ ] Stakeholder decision needed: public branding lookup only vs full routing

---

### Sprint 5: "MVP Launch" — Seed Data, Docs & Release

**Goal:** Publishable MVP with demo experience and contributor docs.
**Duration:** 1-2 weeks

#### 5.1 Demo Experience

- [ ] Seed data creates realistic "Series A Funding Room" (F143)
- [ ] Demo walkthrough documented (README or getting-started guide)
- [ ] Screenshots/GIFs for README

#### 5.2 Documentation

- [ ] README.md: proper getting-started, screenshots, feature list
- [ ] Update IMPLEMENTATION_STATUS.md to reflect reality
- [ ] API documentation (auto-generated or manual)
- [ ] Self-hosting guide
- [ ] Contributor quick-start

#### 5.3 Release Preparation

- [ ] Version tagging (v0.1.0 → v1.0.0-beta)
- [ ] CHANGELOG generation
- [ ] License headers audit (AGPLv3)
- [ ] Docker image published
- [ ] GitHub release with release notes

#### 5.4 QA Final Pass

- [ ] Run full QA_TEST_PLAN.md checklist (50+ test cases)
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Load testing (concurrent users, large file uploads)

#### Sprint 5 Exit Criteria

- Demo room accessible and impressive
- README is compelling and complete
- Docker image runs with `docker compose up`
- QA checklist >95% passing
- Tagged release on GitHub

---

## Post-MVP: V1 Planning Horizon

Once MVP ships, V1 features expand into enterprise capabilities. Key V1 features include:

| Category         | Features                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **Security**     | Encryption at rest (F120), dynamic watermarking (F015), NDA gating (F023), IP restrictions (F022) |
| **Auth**         | SSO/SAML (F018), two-factor authentication (F021)                                                 |
| **Analytics**    | Advanced analytics dashboard, page-level heatmaps, time-on-page                                   |
| **Integrations** | Webhooks (F029), API keys, Slack/Teams notifications                                              |
| **Enterprise**   | White-labeling, custom email templates, SLA reporting                                             |
| **Performance**  | Chunked uploads, CDN integration, search with Meilisearch                                         |

### Backlog Items (from BACKLOG.md)

**Document Preview Enhancements** (high priority post-MVP):

- XLSX viewer (SheetJS or server-side rendering)
- PPTX viewer (pdf.js conversion or dedicated viewer)
- DOCX viewer (mammoth.js or LibreOffice conversion)
- CSV with formatted table view
- Markdown rendering
- Code syntax highlighting

Options under consideration: client-side viewers, server-side PDF conversion (LibreOffice/unoconv), third-party services, or thumbnail generation during upload.

---

## Risk Register

| Risk                              | Impact         | Mitigation                                                      |
| --------------------------------- | -------------- | --------------------------------------------------------------- |
| Azure service outage              | Site down      | Health monitoring + documented recovery procedures              |
| ClamAV scanning bottleneck        | Upload delays  | Passthrough provider for dev; scale scan workers                |
| Large file uploads (500MB)        | Timeout/OOM    | Chunked upload is V1; current limit adequate for MVP            |
| Cross-browser rendering           | Viewer broken  | E2E tests across browsers in Sprint 4                           |
| Prisma migration conflicts        | Deploy failure | Test migrations in staging; rollback procedure                  |
| Security vulnerability discovered | Data breach    | Security tests in CI; responsible disclosure process documented |

---

## Working Model

- **Lead Developer:** Claude (AI) — autonomous execution, self-review, continuous progress
- **Stakeholder:** Mark Munger — review and approval at sprint boundaries; decision points flagged only when blocking
- **Testing:** Live validation via Chrome browser against deployed staging environment
- **Process:** No pause-and-confirm cycles. AI writes code, self-reviews, tests in browser, fixes issues, and continues. Issues are flagged only if they require stakeholder decisions.
- Azure infrastructure already provisioned (Container Apps, PostgreSQL, Redis, Blob Storage)
- No hard deadline — quality over speed
- Sprints are flexible in duration; exit criteria matter more than dates

---

## Summary Timeline

```
Sprint 1 (2-3 wks)  ████████████  UI Completion & Backend Gaps
Sprint 2 (2-3 wks)  ████████████  Testing & Quality
Sprint 3 (1-2 wks)  ██████        CI/CD & DevOps
Sprint 4 (2-3 wks)  ████████████  Hardening & Polish
Sprint 5 (1-2 wks)  ██████        Seed Data, Docs & Release
                                   ─────────────────────────
                     Total: ~8-13 weeks to MVP-complete
```

---

## Decision Points for Stakeholders

1. **F001 Custom Domain Scope** — Is MVP just public branding lookup, or full org-aware domain routing? This affects Sprint 4 scope.
2. **Test Infrastructure** — Integration tests require Azure services in CI. Budget for CI runner costs.
3. **ClamAV in Production** — Real virus scanning vs. passthrough? Affects infrastructure cost.
4. **MVP Launch Target** — Public GitHub release? Private beta first? Affects Sprint 5 scope.
5. **V1 Prioritization** — Which V1 features to start after MVP? SSO and watermarking are most requested in competitive VDR market.
