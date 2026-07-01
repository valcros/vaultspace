# VaultSpace Backlog

Post-MVP enhancements and technical debt items.

## High Priority

### MVP Launch Closeout (Active)

**Status:** In progress
**Updated:** 2026-06-30

Current active work before MVP launch readiness:

- Deploy the latest `sprint/ops-stabilization-20260630` branch code to Azure staging.
- Re-verify worker KEDA Redis scaler metadata after deployment.
- Run no-email live smoke with a durable QA account.
- Complete the manual `QA_TEST_PLAN.md` pass.
- Complete cross-browser and per-resource accessibility QA.
- Create release notes, changelog entry, and an agreed release tag.
- Smoke Docker Compose self-hosting before any public beta release.

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
- Durable QA account and smoke-secret handling for staging

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
- ~~**Complete DMARC verification for vaultspace.org sender domain:**~~ Resolved 2026-04-26. `_dmarc.vaultspace.org` is already published as `v=DMARC1; p=quarantine; pct=100` and resolves publicly via Cloudflare DoH. ACS does not actively verify DMARC (the dashboard's `DMARC: NotStarted` is a reserved informational field — only Domain/SPF/DKIM/DKIM2 appear in `verificationRecords`). Optional follow-up: add `rua=mailto:dmarc-reports@vaultspace.org` once an inbox is provisioned to receive aggregate reports.
- ~~**`watermark_configs` table referenced in RLS but never created:**~~ Resolved 2026-04-26. Removed the watermark_configs ENABLE RLS / CREATE POLICY blocks from `prisma/rls-policies.sql` (with comments indicating they should be restored when the V1 watermarking table lands). Added `psql -v ON_ERROR_STOP=1` to `docker-entrypoint.sh` so any future missing-table error fails the deploy loudly instead of silently leaving the database half-configured.
