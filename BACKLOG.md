# VaultSpace Backlog

Post-MVP enhancements and technical debt items.

## High Priority

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
- **highlight.js CDN dependency**: Bundle CSS locally instead of CDN link
- **Smart thumbnail cropping**: ✅ Implemented (ThumbnailCropper class handles sparse content like CAD drawings)

## Medium Priority

- ~~Replace remaining `window.confirm()` calls with proper confirmation dialogs~~ ✅ Done (webhooks, share links, remove member)
- Accessibility audit (WCAG 2.1 AA)
- Production deployment workflow (tag-based)

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

## Security / Operations

- **Container App env var audit (in progress):** Ensure every sensitive env var on every Container App is bound via `secretRef` to a Key Vault secret rather than a literal `value`. On 2026-04-26 a stray plaintext `ACS_CONNECTION_STRING` on `ca-vaultspace-web` exposed the ACS access key in `az containerapp show` output, requiring an emergency key rotation. Worker was correctly configured. Add a periodic guardrail (script or pre-deploy CI check) that fails when any `properties.template.containers[].env[].value` matches a known secret pattern. See `.private/azure-staging.md` for rotation log.
- ~~**Health check email/scan capability gap:**~~ Resolved 2026-04-26 (capability resolver). The capability resolver now recognizes `EMAIL_PROVIDER=acs` + `ACS_CONNECTION_STRING` as a valid email transport and treats `SCAN_ENGINE=passthrough` as an intentional scanning configuration rather than a missing dependency. ClamAV remains intentionally bypassed in staging.
- **Async notification jobs are unconsumed in staging:** `ca-vaultspace-worker` runs with `WORKER_TYPE=preview`, which only listens on the `high` BullMQ queue. Notification jobs (`notify-document-uploaded`, `notify-document-viewed`, `email.send`) are enqueued on the `normal` queue, which only the `general` worker type consumes. As a result, document upload/view notifications are silently dropped in staging. User-invite emails still work because that path calls `providers.email.sendEmail()` synchronously rather than queueing. Fix options: (1) change the existing worker to `WORKER_TYPE=general` and expand its queue subscription to include `high` (route preview jobs through `normal` instead, or have the worker subscribe to both queues), or (2) deploy a second Container App with `WORKER_TYPE=general` for notification/email/export jobs while keeping the dedicated preview worker. Option 2 is closer to the documented worker taxonomy in `JOB_SPECS.md`.
- **Investigate duplicate ACS resources:** Both `acs-vaultspace-email` (with verified `vaultspace.org` sender domain) and `acs-vaultspace-staging` (connection-string target) exist. Confirm one is authoritative and delete or repurpose the other.
