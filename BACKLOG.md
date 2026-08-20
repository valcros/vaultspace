# VaultSpace Backlog

Post-MVP enhancements and technical debt items.

## Completed Items & Security Hardening (2026-08-20)

**Status:** Completed & Deployed to Staging (`ca-vaultspace-web--0000317`)

1. **SysOp Interactive Column Sorting & Status Filtering (`/sysop`):**
   - Added interactive click-to-sort on all Tenant Directory table headers (`Organization Name`, `Slug`, `Rooms`, `Users`, `Storage Usage`, `Status`) with visual sort direction indicators (`ArrowUpDown`, `ArrowUp`, `ArrowDown`).
   - Added segmented status filter buttons (`All`, `Active`, `Disabled`) with real-time tenant count badges.
   - Added live search query input filtering tenants by name or slug.
   - Uncapped `/api/sysop/overview` telemetry query limit to return all platform tenants.
2. **Organization Lifecycle Sprints Merged (Sprints 1–3):**
   - **Sprint 1 (Email Verification Gate):** Registration requires email verification before org creation.
   - **Sprint 2 (SysOp Tenant Management):** In-app tenant disable/enable and bulk-disable for 283 junk orgs.
   - **Sprint 3 (Per-Tenant Backup & Restore Tooling):** Single-tenant encrypted backup/restore safety net scripts (`npm run ops:backup-org`).
3. **In-App SysOp IP Allowlist & Self-Lockout Guard (`/sysop/security`):**
   - SysOp security management UI and REST control plane (`/api/sysop/security/ip-allowlist`) with self-lockout guard.
4. **Session Subnet & User-Agent Binding:**
   - Applied DDL migration `20260819120000_add_sysop_ip_allowlist_and_session_binding`.
   - Enforces IPv4 `/24` (and IPv6 `/64`) subnet binding and User-Agent fingerprinting across user sessions.
5. **Interactive UX & Focus Retention E2E Test Suite (`tests/e2e/interactive-ux-stress.spec.ts`):**
   - Playwright E2E test suite running real-time keystroke typing (50ms intervals) asserting DOM focus retention (`toBeFocused()`).
6. **Room Audit Trail Focus & Layout Fix (`/rooms/[roomId]/audit`):**
   - Resolved early-return layout unmounting bug in `src/app/(admin)/rooms/[roomId]/audit/page.tsx`.

---

## High Priority

### MVP Launch Closeout (Active)

**Status:** In progress
**Updated:** 2026-08-19

Current active work before MVP launch readiness:

- Deploy the latest `sprint/ops-stabilization-20260630` branch code to Azure staging.
- Re-verify worker KEDA Redis scaler metadata after deployment.
- Run no-email live smoke with a durable QA account.
- Complete the manual `QA_TEST_PLAN.md` pass.
- Complete cross-browser and per-resource accessibility QA.
- Create release notes, changelog entry, and an agreed release tag.
- Smoke Docker Compose self-hosting before any public beta release.

### Standalone Staging Environment Infrastructure Isolation (Roadmap Enhancement)

**Status:** Planned / Architecture Settled
**Requested:** 2026-08-19 (Stakeholder Directive)
**Target Phase:** Post-MVP Infrastructure Hardening

Currently, `staging.vaultspace.org` and `vaultspace.org` share a single Azure Container App instance (`ca-vaultspace-web`) and a single PostgreSQL database (`psql-vaultspace-staging`). Environment isolation is currently tenant-scoped via software Row-Level Security (RLS `organizationId`).

To achieve true, physical infrastructure isolation where development and code changes land safely on staging without impacting live production tenants, the following technical execution specification must be followed when this roadmap item is pulled for execution:

1. **Azure Physical Resource Provisioning:**
   - **Isolated Database:** Provision dedicated Azure Database for PostgreSQL Flexible Server `psql-vaultspace-staging-isolated` (separate from `psql-vaultspace-production`).
   - **Isolated Container App:** Provision dedicated Azure Container App `ca-vaultspace-web-staging` and background worker `ca-vaultspace-worker-staging` in resource group `rg-vaultspace-staging-isolated`.
   - **Isolated Key Vault & Redis:** Provision separate Key Vault `kv-vaultspace-staging-iso` and Redis cache instance `redis-vaultspace-staging-iso`.
2. **DNS & Routing Separation:**
   - Re-point CNAME `staging.vaultspace.org` exclusively to the ingress endpoint of `ca-vaultspace-web-staging`.
   - Ensure `vaultspace.org` (production) maps exclusively to `ca-vaultspace-web-prod`.
3. **CI/CD Pipeline Separation (`.github/workflows/deploy-staging.yml` vs `deploy-prod.yml`):**
   - Refactor `deploy-staging.yml` to target `rg-vaultspace-staging-isolated` credentials and database secrets.
   - Decouple schema migration deployment (`prisma migrate deploy`) so staging migrations execute strictly against `psql-vaultspace-staging-isolated` before any production release cutover.

### Full User Profiles & NDA-on-File (Stakeholder Request)

**Status:** Proposed
**Requested:** 2026-07-18
**Requested by:** Lead (Brightside investor onboarding)

Add an admin flow to create a complete user profile in one step, beyond the current email-plus-role invite. Captured fields:

- Name (first, last)
- Email
- Company
- Phone
- NDA on file (boolean)
- Type: Founder, Investor, Partner, Investor Rep, Employee, Consultant

**NDA-on-file behavior:** When "NDA on file" is set, the user bypasses the NDA click-through gate on room and share-link access. Instead of blocking entry until they accept, show a non-blocking reminder that an executed NDA is already on record. When the flag is unset, the existing NDA acceptance gate (F130) applies unchanged.

**Notes / open questions:**

- New profile fields (company, phone, type) require a schema addition on `users` (or a related profile table) plus migration and RLS coverage.
- "Type" is a new enum; confirm whether it drives permissions/UX or is metadata only.
- NDA-on-file needs an audit trail (who marked it, when, optional reference to the signed document) so the bypass is defensible.
- Reconcile with the existing invitation flow (`/api/users/invite`) and the viewer share-link NDA gate (F130) so both honor the flag.

### Dashboard UX Redesign (Stakeholder Feedback) ✅ IMPLEMENTED

**Status:** Complete
**Reported:** 2026-04-04
**Completed:** 2026-04-04

Implemented role-based dashboard with actionable widgets:

**Architecture:**

- New `/api/dashboard/v2` endpoint with role-aware data aggregation
- 11 specialized widget components in `src/components/dashboard/`
- Role-based layouts: Admin dashboard vs Viewer dashboard

**Admin Dashboard Features:**

- Action Required widget (pending questions, access requests)
- Engagement metrics (views, viewers, downloads, activity chart)
- Room overview with status and document counts
- Checklist progress tracking
- Recent activity timeline

**Viewer Dashboard Features:**

- Messages widget (unread count, recent messages)
- New Documents Since Last Visit
- Continue Reading (resume where you left off)
- Bookmarks
- My Questions (track submitted Q&A)
- Room announcements

**Files created/modified:**

- `src/app/api/dashboard/v2/route.ts` - New dashboard API
- `src/app/(admin)/dashboard/page.tsx` - Role-based layouts
- `src/components/dashboard/*.tsx` - 11 widget components
- `docs/DASHBOARD_REDESIGN.md` - Design documentation

---

### Document Preview Enhancements ✅ IMPLEMENTED

Implemented via two-tier architecture (see DOCUMENT_PREVIEW_PLAN.md):

**Phase 1 — Gotenberg (server-side conversion to PDF):**

- DOCX, XLSX, PPTX, DOC, XLS, PPT (Microsoft Office)
- ODT, ODS, ODP, ODG (OpenDocument/Google)
- VSDX, VSD (Visio — limited fidelity)
- RTF, EPUB, HTML

**Phase 2 — Client-side rendering (no conversion needed):**

- Markdown (markdown-it → styled HTML)
- Code files (highlight.js — 40+ languages)
- JSON, YAML, XML (syntax highlighted)
- CSV (papaparse → formatted table)
- SVG (native browser, sanitized with DOMPurify)

**Requires:** Gotenberg Docker sidecar (`gotenberg/gotenberg:8`) + `PREVIEW_ENGINE=gotenberg` env var

### Remaining Preview Items

- ~~**Phase 3 formats** (deferred): EPS/AI (Ghostscript), DXF (dxf-parser), DWG (ODA converter)~~ ✅ EPS/AI/DXF implemented (DWG deferred - requires ODA File Converter with complex licensing)
- ~~**PDF page rasterization**: Sharp with poppler support for high-fidelity page renders~~ ✅ Implemented via pdftoppm (poppler-utils)
- ~~**highlight.js CDN dependency:**~~ Resolved. `TextPreviewRenderer` imports `highlight.js/styles/github.css` from the package. Remaining related item: PDF.js worker still loads from `unpkg.com` and should be bundled locally if self-hosted/no-CDN operation is required.
- **Smart thumbnail cropping**: ✅ Implemented (ThumbnailCropper class handles sparse content like CAD drawings)

## Medium Priority

- ~~Replace remaining `window.confirm()` calls with proper confirmation dialogs~~ ✅ Done (webhooks, share links, remove member)
- ~~Accessibility audit (WCAG 2.1 AA)~~ ✅ Updated 2026-04-27 — full automated pass against staging covers 4 public + 8 authenticated pages, all 13 tests green. Login fixture lives at `tests/e2e/auth.setup.ts`. Per-resource pages (room detail, document viewer, public viewer link landing) and the manual screen-reader pass remain on the punch list before MVP launch. Full audit trail in `docs/A11Y_AUDIT.md`.
- Production deployment workflow (tag-based)
- Durable QA account and smoke-secret handling for staging (see `docs/AI_TEST_CREDENTIALS_PLAN.md` for the proposed method: isolated QA tenant, Key Vault-sourced passwords, and AI-safe session minting)

## Low Priority

- OnlyOffice integration for collaborative editing
- ~~Dark mode theme~~ ✅ Implemented (next-themes, ThemeProvider, theme toggle, core component dark: classes)
- ~~Keyboard shortcuts documentation page~~ ✅ Implemented (/settings/shortcuts)

## Technical Debt

- ~~Update GitHub Actions to Node.js 24 (deprecation warning)~~ ✅ Done (ci.yml, deploy-staging.yml, standalone-validation.yml)
- Azure CLI Python 3.14 compatibility (az ad sp create-for-rbac broken) - Note: No az ad sp commands found in workflows
- **Preview helper unit tests**: Add dedicated tests for:
  - `src/providers/preview/helpers/ThumbnailCropper.ts`
  - `src/providers/preview/helpers/DxfRenderer.ts`
  - `src/providers/preview/helpers/GhostscriptConverter.ts`
  - `src/providers/preview/helpers/PdfRasterizer.ts`
- **ESLint warnings**: Fix React hook dependency warnings and console statements (see lint output)

## Resolved Critical (2026-04-26)

- ~~**RLS is enabled but not enforcing in staging**~~ Fixed 2026-04-26. Added a low-privilege runtime database role, forced RLS on org-scoped tables, separated migration/admin credentials from runtime credentials, and updated deployment validation to require the admin URL only where migrations run. Re-running the RLS audit as the runtime role returns no rooms without org context. Exact role and secret names are kept in private operator records.

## Security / Operations

- **Container App env var audit (in progress):** Ensure every sensitive env var on every Container App is bound via `secretRef` rather than a literal `value`. A past staging plaintext secret exposure required key rotation, so the deployment guardrail must fail when container env output contains likely secret material. Keep rotation logs in private operator records.
- ~~**Health check email/scan capability gap:**~~ Resolved 2026-04-26 (capability resolver). The capability resolver now recognizes `EMAIL_PROVIDER=acs` + `ACS_CONNECTION_STRING` as a valid email transport and treats `SCAN_ENGINE=passthrough` as an intentional scanning configuration rather than a missing dependency. ClamAV remains intentionally bypassed in staging.
- ~~**Async notification jobs are unconsumed in staging:**~~ Resolved 2026-04-26. The `general` worker type now subscribes to all three BullMQ priority queues (`high`, `normal`, `low`) with concurrency 6, so a single worker Container App handles previews, scans, notifications, exports, and cleanup. Specialized worker types remain available for future scale-out. Verification surfaced missing runtime config in the worker, which is now covered by deployment validation. Worker now drains all queues cleanly.
- ~~**Worker config drift between web and worker Container Apps:**~~ Resolved 2026-04-26. Added `scripts/validate-container-env.sh` that fails the deploy when a required env var is missing or when a secret-backed var is bound as a literal value rather than a Key Vault `secretRef`. Wired into `deploy-staging.yml` after the image update step.
- ~~**Worker startup failures masked as Healthy:**~~ Resolved 2026-04-26. Worker now starts an HTTP health server on port 3000 (`WORKER_HEALTH_PORT` overridable) only after BullMQ workers initialize and subscribe to their queues. Container Apps Liveness, Readiness, and Startup probes attached to the worker spec target this port via TCP. A crash-looping worker now correctly fails the probe and is reported as unhealthy. Validation script also checks that the probe is present so a future YAML round-trip cannot silently strip it.
- ~~**Redis version warning:**~~ Resolved 2026-06-30. Staging was migrated to managed Redis on a BullMQ-supported version with encrypted protocol enabled, and recent app health checks are clean. Keep rollback cache infrastructure only through the approved observation window; do not delete it without fresh explicit cleanup approval.
- ~~**Investigate duplicate ACS resources:**~~ Resolved 2026-04-26. Not duplicates — `acs-vaultspace-email` is a `Microsoft.Communication/EmailServices` resource that owns the verified `vaultspace.org` sender domain, and `acs-vaultspace-staging` is a `Microsoft.Communication/CommunicationServices` resource that holds the SDK connection string and is linked to the email domain. Both are required.
- ~~**Complete DMARC verification for vaultspace.org sender domain:**~~ Resolved 2026-04-26. `_dmarc.vaultspace.org` is already published as `v=DMARC1; p=quarantine; pct=100` and resolves publicly via Cloudflare DoH. ACS does not actively verify DMARC (the dashboard's `DMARC: NotStarted` is a reserved informational field — only Domain/SPF/DKIM/DKIM2 appear in `verificationRecords`). Done (2026-08-09): added `rua=mailto:security@vaultspace.org` for aggregate reports. `vaultspace.org` was also added to Exchange Online for inbound (MX + autodiscover + DKIM `selector1/2._domainkey`), coexisting with ACS sending.
- ~~**`watermark_configs` table referenced in RLS but never created:**~~ Resolved 2026-04-26. Removed the watermark_configs ENABLE RLS / CREATE POLICY blocks from `prisma/rls-policies.sql` (with comments indicating they should be restored when the V1 watermarking table lands). Added `psql -v ON_ERROR_STOP=1` to `docker-entrypoint.sh` so any future missing-table error fails the deploy loudly instead of silently leaving the database half-configured.
