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
- ~~**Async notification jobs are unconsumed in staging:**~~ Resolved 2026-04-26. The `general` worker type now subscribes to all three BullMQ priority queues (`high`, `normal`, `low`) with concurrency 6, so a single worker Container App handles previews, scans, notifications, exports, and cleanup. Specialized worker types (preview, scan, report) remain available for future scale-out. `ca-vaultspace-worker` env updated to `WORKER_TYPE=general`. While verifying the rollout, two pre-existing config gaps surfaced: the worker container had no `SESSION_SECRET` (it was crash-looping silently for an unknown duration, masked by Container Apps "Healthy" status during restart cycles) and no `APP_URL` (so notification jobs were failing on dequeue). Both env vars were added — `SESSION_SECRET` via `secretref:sessionsecret` Key Vault binding, `APP_URL=https://vaultspace.org` matching the web app. Worker now drains all queues cleanly.
- **Worker config drift between web and worker Container Apps:** The web container has `SESSION_SECRET`, `APP_URL`, etc. but the worker container did not until 2026-04-26. The image is the same; the env shape should be too. Add a CI guardrail or shared YAML template that ensures both containers receive every required env var, or document the worker's minimum env contract in `DEPLOYMENT.md`.
- **Worker startup failures masked as Healthy:** Container Apps reports a revision as `Healthy` after enough restarts even when `process.exit(1)` is fired during startup. The actual failure is only visible in console logs. Consider a startup-success probe or external job-queue health check (e.g., poll BullMQ for an `EMPTY` vs `STALLED` state) so we don't miss this class of regression again.
- **Redis version warning:** Worker logs show "It is highly recommended to use a minimum Redis version of 6.2.0. Current: 6.0.14". The Azure Cache for Redis Basic SKU is on 6.0.14. Plan a SKU upgrade or version bump before MVP launch.
- **Investigate duplicate ACS resources:** Both `acs-vaultspace-email` (with verified `vaultspace.org` sender domain) and `acs-vaultspace-staging` (connection-string target) exist. Confirm one is authoritative and delete or repurpose the other.
