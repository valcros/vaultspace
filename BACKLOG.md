# VaultSpace Backlog

Post-MVP enhancements and technical debt items.

## High Priority

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

- **Phase 3 formats** (deferred): EPS/AI (Ghostscript), DXF (dxf-parser), DWG (ODA converter)
- **PDF page rasterization**: Sharp with poppler support for high-fidelity page renders (currently uses placeholders if poppler unavailable)
- **highlight.js CDN dependency**: Bundle CSS locally instead of CDN link

## Medium Priority

- Replace remaining `window.confirm()` calls with proper confirmation dialogs
- Accessibility audit (WCAG 2.1 AA)
- Production deployment workflow (tag-based)

## Low Priority

- OnlyOffice integration for collaborative editing
- Dark mode theme
- Keyboard shortcuts documentation page

## Technical Debt

- Update GitHub Actions to Node.js 24 (deprecation warning)
- Azure CLI Python 3.14 compatibility (az ad sp create-for-rbac broken)
