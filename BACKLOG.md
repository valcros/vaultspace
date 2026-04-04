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
