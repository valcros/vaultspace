# Document Preview Expansion Plan

> **Created:** 2026-03-26
> **Status:** Draft for Review
> **Scope:** Expand preview support from 9 formats to 40+ formats

## Current State

**Currently previewable inline:** PDF, JPEG, PNG, GIF, WebP, TIFF, TXT, CSV
**Currently uploadable but no preview:** DOCX, XLSX, PPTX, DOC, XLS, PPT, Markdown
**Preview engine:** Sharp (images) + pdf-lib (PDF metadata) + react-pdf (client-side PDF viewer)

**Key limitation:** No server-side document-to-PDF conversion. Office documents upload successfully but show "Preview not available."

## Architecture Decision: Gotenberg as Conversion Service

**Recommendation:** Deploy **Gotenberg** as a Docker sidecar service for server-side document conversion.

**Why Gotenberg:**

- Wraps LibreOffice + Chromium in a clean HTTP API
- Converts Office, OpenDocument, HTML, Markdown, images → PDF
- MIT licensed (compatible with AGPL-3.0)
- Stateless, horizontally scalable
- Already referenced in the codebase (`DEPLOYMENT.md`, `CONTRIBUTING.md`)
- ~8K GitHub stars, actively maintained

**Alternative considered:** OnlyOffice Document Server — overkill for preview-only (adds editing), heavy infrastructure (2GB+ RAM, multiple containers).

## Format Support Matrix

### Tier 1 — Gotenberg Conversion (server-side → PDF → react-pdf viewer)

These formats will be converted to PDF on upload, then displayed using the existing react-pdf viewer.

| Format                    | Extension | MIME Type                                                                 | Conversion                               |
| ------------------------- | --------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| Word (modern)             | .docx     | application/vnd.openxmlformats-officedocument.wordprocessingml.document   | Gotenberg/LibreOffice                    |
| Word (legacy)             | .doc      | application/msword                                                        | Gotenberg/LibreOffice                    |
| Excel (modern)            | .xlsx     | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         | Gotenberg/LibreOffice                    |
| Excel (legacy)            | .xls      | application/vnd.ms-excel                                                  | Gotenberg/LibreOffice                    |
| PowerPoint (modern)       | .pptx     | application/vnd.openxmlformats-officedocument.presentationml.presentation | Gotenberg/LibreOffice                    |
| PowerPoint (legacy)       | .ppt      | application/vnd.ms-powerpoint                                             | Gotenberg/LibreOffice                    |
| OpenDocument Text         | .odt      | application/vnd.oasis.opendocument.text                                   | Gotenberg/LibreOffice                    |
| OpenDocument Spreadsheet  | .ods      | application/vnd.oasis.opendocument.spreadsheet                            | Gotenberg/LibreOffice                    |
| OpenDocument Presentation | .odp      | application/vnd.oasis.opendocument.presentation                           | Gotenberg/LibreOffice                    |
| OpenDocument Graphics     | .odg      | application/vnd.oasis.opendocument.graphics                               | Gotenberg/LibreOffice                    |
| Rich Text Format          | .rtf      | application/rtf                                                           | Gotenberg/LibreOffice                    |
| Visio (modern)            | .vsdx     | application/vnd.ms-visio.drawing.main+xml                                 | Gotenberg/LibreOffice (limited fidelity) |
| Visio (legacy)            | .vsd      | application/vnd.visio                                                     | Gotenberg/LibreOffice (limited fidelity) |
| HTML                      | .html     | text/html                                                                 | Gotenberg/Chromium                       |
| EPUB                      | .epub     | application/epub+zip                                                      | Gotenberg/LibreOffice                    |

### Tier 2 — Client-Side Rendering (no server conversion needed)

These formats will be rendered directly in the browser with specialized libraries.

| Format                      | Extension           | MIME Type        | Library                    | Bundle Size |
| --------------------------- | ------------------- | ---------------- | -------------------------- | ----------- |
| Markdown                    | .md                 | text/markdown    | markdown-it + highlight.js | ~100KB      |
| Code (JS, TS, Python, etc.) | .js, .ts, .py, etc. | text/\*          | highlight.js (auto-detect) | ~70KB       |
| JSON                        | .json               | application/json | highlight.js + tree view   | ~10KB       |
| YAML                        | .yaml, .yml         | text/yaml        | highlight.js               | included    |
| XML                         | .xml                | application/xml  | highlight.js               | included    |
| CSV                         | .csv                | text/csv         | papaparse + table renderer | ~20KB       |
| SVG                         | .svg                | image/svg+xml    | Native browser (sanitized) | 0KB         |

### Tier 3 — Specialized Server-Side Tools

| Format | Extension | MIME Type               | Tool                           | Notes                                   |
| ------ | --------- | ----------------------- | ------------------------------ | --------------------------------------- |
| EPS    | .eps      | application/postscript  | Ghostscript (AGPL-3.0)         | Convert to PDF/PNG                      |
| AI     | .ai       | application/illustrator | Ghostscript                    | Modern AI files are PDF-based           |
| DXF    | .dxf      | application/dxf         | dxf-parser → SVG               | 2D CAD drawings                         |
| DWG    | .dwg      | application/acad        | ODA File Converter → DXF → SVG | Proprietary format, limited OSS support |

### Tier 4 — Fallback (download only)

| Format              | Reason                               |
| ------------------- | ------------------------------------ |
| ZIP/RAR archives    | Container format, no preview concept |
| Binary/executable   | Security risk                        |
| Database files      | Specialized software required        |
| Proprietary formats | No OSS converter available           |

## Implementation Plan

### Phase 1: Gotenberg Integration (highest impact)

**Covers:** DOCX, XLSX, PPTX, DOC, XLS, PPT, ODT, ODS, ODP, ODG, RTF, VSDX, HTML, EPUB

**Work items:**

1. **Create GotenbergPreviewProvider** (`src/providers/preview/GotenbergPreviewProvider.ts`)
   - HTTP client to Gotenberg API (`POST /forms/libreoffice/convert/pdf`)
   - Accepts buffer + content type, returns PDF buffer
   - Configurable via `GOTENBERG_URL` environment variable
   - Timeout handling (30s default for large documents)
   - Retry logic for transient failures

2. **Update PreviewProvider factory** (`src/providers/preview/index.ts`)
   - Add `PREVIEW_ENGINE=gotenberg` option
   - Fall back to Sharp for images when Gotenberg unavailable
   - Chain: Gotenberg for documents, Sharp for images/thumbnails

3. **Update preview processor** (`src/workers/previewProcessor.ts`)
   - Route document types to Gotenberg, image types to Sharp
   - Store converted PDF as preview asset (`assetType: 'PDF'`)
   - Generate page-by-page PNG renders from converted PDF (for thumbnail/page views)

4. **Update MIME type support** (`src/lib/fileTypes.ts`, `src/services/DocumentService.ts`)
   - Add OpenDocument MIME types (ODT, ODS, ODP, ODG)
   - Add Visio MIME types (VSD, VSDX)
   - Add RTF, EPUB, HTML MIME types
   - Update `SUPPORTED_MIME_TYPES` in DocumentService

5. **Update preview API route** (`src/app/api/.../preview/route.ts`)
   - Serve converted PDF for Gotenberg-processed documents
   - Maintain existing inline behavior for images/text

6. **Infrastructure:** Add Gotenberg to `docker-compose.yml` and Azure Container Apps

**Estimated effort:** 2-3 days

### Phase 2: Client-Side Renderers (text/code formats)

**Covers:** Markdown, code files, JSON, YAML, XML, CSV (formatted), SVG

**Work items:**

1. **Install dependencies**
   - `markdown-it` — Markdown to HTML
   - `highlight.js` — syntax highlighting (190+ languages)
   - `papaparse` — CSV parsing
   - `dompurify` — HTML/SVG sanitization

2. **Create TextPreviewRenderer component** (`src/components/documents/TextPreviewRenderer.tsx`)
   - Detects format from MIME type/extension
   - Markdown: renders as styled HTML
   - Code: syntax-highlighted with line numbers
   - JSON: collapsible tree view
   - CSV: formatted table with headers
   - SVG: sanitized inline rendering

3. **Update DocumentViewer** (`src/components/documents/DocumentViewer.tsx`)
   - Add rendering branch for text/code types
   - Use TextPreviewRenderer for non-PDF text formats

4. **Update MIME type support**
   - Add code file MIME types (text/javascript, text/x-python, etc.)
   - Add application/json, text/yaml, application/xml
   - Map file extensions to MIME types for auto-detection

**Estimated effort:** 1-2 days

### Phase 3: Specialized Formats (if needed)

**Covers:** EPS, AI, DXF

**Work items:**

1. Add Ghostscript to Docker image for EPS/AI conversion
2. Implement `dxf-parser` based DXF → SVG converter
3. Add MIME types for vector/CAD formats

**Estimated effort:** 1-2 days (can be deferred)

## New Dependencies

| Package        | Purpose               | License        | Size       |
| -------------- | --------------------- | -------------- | ---------- |
| `markdown-it`  | Markdown → HTML       | MIT            | ~50KB      |
| `highlight.js` | Syntax highlighting   | BSD-3          | ~70KB core |
| `papaparse`    | CSV parsing           | MIT            | ~20KB      |
| `dompurify`    | HTML/SVG sanitization | MIT/Apache-2.0 | ~15KB      |

**Gotenberg** runs as a separate Docker container — no npm dependency.

## Environment Variables

| Variable         | Default                 | Purpose                                         |
| ---------------- | ----------------------- | ----------------------------------------------- |
| `GOTENBERG_URL`  | `http://gotenberg:3000` | Gotenberg service URL                           |
| `PREVIEW_ENGINE` | `gotenberg`             | Provider selection (gotenberg, sharp, disabled) |

## Format Count Summary

| Category              | Current         | After Phase 1 | After Phase 2 | After Phase 3 |
| --------------------- | --------------- | ------------- | ------------- | ------------- |
| Previewable formats   | 9               | 24            | 35+           | 38+           |
| Client-side rendered  | 3 (PDF, images) | 3             | 10+           | 10+           |
| Server-side converted | 0               | 15            | 15            | 18            |
| Upload-supported      | 13              | 22+           | 30+           | 33+           |

## Priority Order

1. **Phase 1** — Gotenberg integration: DOCX, XLSX, PPTX, ODT, ODS, ODP, VSDX (most requested)
2. **Phase 2** — Client-side: Markdown, code, JSON, CSV (developer-friendly)
3. **Phase 3** — Specialized: EPS, DXF (niche, defer if not requested)

## Visio Note

Visio support via LibreOffice/Gotenberg will have **limited fidelity** — basic shapes and connectors render well, but complex diagrams with custom stencils, data-linked shapes, or embedded OLE objects may not render correctly. This is a known limitation across all open-source converters. For high-fidelity Visio rendering, a commercial solution (Microsoft's API or Aspose) would be needed. For MVP, the LibreOffice conversion provides acceptable results for most business diagrams.
