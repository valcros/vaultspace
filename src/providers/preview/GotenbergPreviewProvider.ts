/**
 * Gotenberg Preview Provider
 *
 * Uses Gotenberg (LibreOffice + Chromium) for document-to-PDF conversion,
 * then Sharp for PDF page rasterization and thumbnails.
 *
 * Gotenberg API: https://gotenberg.dev/docs/routes
 */

import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

import type { PreviewOptions, PreviewPage, PreviewProvider, PreviewResult } from '../types';

// MIME types that Gotenberg can convert to PDF via LibreOffice
const GOTENBERG_OFFICE_TYPES = new Set([
  // Microsoft Office (modern)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
  // Microsoft Office (legacy)
  'application/msword', // DOC
  'application/vnd.ms-excel', // XLS
  'application/vnd.ms-powerpoint', // PPT
  // OpenDocument
  'application/vnd.oasis.opendocument.text', // ODT
  'application/vnd.oasis.opendocument.spreadsheet', // ODS
  'application/vnd.oasis.opendocument.presentation', // ODP
  'application/vnd.oasis.opendocument.graphics', // ODG
  // Visio
  'application/vnd.ms-visio.drawing.main+xml', // VSDX
  'application/vnd.visio', // VSD
  // Other
  'application/rtf', // RTF
  'application/epub+zip', // EPUB
]);

// MIME types that Gotenberg can convert via Chromium (HTML rendering)
const GOTENBERG_CHROMIUM_TYPES = new Set([
  'text/html',
  'text/markdown',
  'text/xml',
  'text/yaml',
  'application/json',
  'application/xml',
]);

// Types handled directly by Sharp (images)
const SHARP_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

// PDF handled natively
const PDF_TYPE = 'application/pdf';

// Text types rendered as syntax-highlighted images
const TEXT_TYPES = new Set(['text/plain', 'text/csv']);

// File extension mapping for Gotenberg API (needs filename with extension)
const MIME_TO_EXTENSION: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.oasis.opendocument.graphics': '.odg',
  'application/vnd.ms-visio.drawing.main+xml': '.vsdx',
  'application/vnd.visio': '.vsd',
  'application/rtf': '.rtf',
  'application/epub+zip': '.epub',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/xml': '.xml',
  'text/yaml': '.yaml',
  'application/json': '.json',
  'application/xml': '.xml',
};

// Color mapping for branded placeholder cards
const EXTENSION_COLORS: Record<string, { bg: string; text: string }> = {
  PDF: { bg: '#fef2f2', text: '#dc2626' },
  DOCX: { bg: '#eff6ff', text: '#2563eb' },
  DOC: { bg: '#eff6ff', text: '#2563eb' },
  XLSX: { bg: '#f0fdf4', text: '#16a34a' },
  XLS: { bg: '#f0fdf4', text: '#16a34a' },
  PPTX: { bg: '#fff7ed', text: '#ea580c' },
  PPT: { bg: '#fff7ed', text: '#ea580c' },
  CSV: { bg: '#f0fdf4', text: '#16a34a' },
  MD: { bg: '#f5f3ff', text: '#7c3aed' },
  HTML: { bg: '#fef3c7', text: '#d97706' },
  JSON: { bg: '#ecfdf5', text: '#059669' },
  XML: { bg: '#fef3c7', text: '#d97706' },
  YAML: { bg: '#fce7f3', text: '#db2777' },
  YML: { bg: '#fce7f3', text: '#db2777' },
  TXT: { bg: '#f9fafb', text: '#6b7280' },
  SVG: { bg: '#faf5ff', text: '#9333ea' },
  VSDX: { bg: '#faf5ff', text: '#9333ea' },
};

export class GotenbergPreviewProvider implements PreviewProvider {
  private gotenbergUrl: string;
  private timeoutMs: number;

  constructor(gotenbergUrl?: string, timeoutMs?: number) {
    this.gotenbergUrl = gotenbergUrl ?? process.env['GOTENBERG_URL'] ?? 'http://localhost:3001';
    this.timeoutMs = timeoutMs ?? 30000;
  }

  isSupported(mimeType: string): boolean {
    return (
      GOTENBERG_OFFICE_TYPES.has(mimeType) ||
      GOTENBERG_CHROMIUM_TYPES.has(mimeType) ||
      SHARP_TYPES.has(mimeType) ||
      TEXT_TYPES.has(mimeType) ||
      mimeType === PDF_TYPE ||
      mimeType === 'image/svg+xml'
    );
  }

  async convert(
    data: Buffer,
    mimeType: string,
    options: PreviewOptions = {}
  ): Promise<PreviewResult> {
    const maxPages = options.maxPages ?? 50;

    // Route to appropriate converter
    if (GOTENBERG_OFFICE_TYPES.has(mimeType)) {
      return this.convertViaGotenbergOffice(data, mimeType, maxPages);
    }

    // SVG goes through image conversion (Sharp), not Chromium
    if (mimeType === 'image/svg+xml') {
      return this.convertSvg(data);
    }

    if (GOTENBERG_CHROMIUM_TYPES.has(mimeType)) {
      return this.convertViaGotenbergChromium(data, mimeType, maxPages);
    }

    if (mimeType === PDF_TYPE) {
      return this.convertPdfToPages(data, maxPages);
    }

    if (SHARP_TYPES.has(mimeType)) {
      return this.convertImage(data);
    }

    if (TEXT_TYPES.has(mimeType)) {
      return this.convertText(data);
    }

    throw new Error(`Unsupported MIME type for preview: ${mimeType}`);
  }

  async generateThumbnail(
    data: Buffer,
    _mimeType: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    return sharp(data).resize(width, height, { fit: 'cover', position: 'top' }).png().toBuffer();
  }

  /**
   * Generate a PNG thumbnail directly from original file bytes.
   * Routes by MIME type to the best rendering strategy.
   * Never throws — catches internally and falls back to branded placeholder,
   * then to Sharp SVG placeholder.
   */
  async generateThumbnailPng(
    data: Buffer,
    mimeType: string,
    fileName: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    try {
      // Images (JPEG, PNG, GIF, WEBP, TIFF, BMP) — Sharp resize directly
      if (SHARP_TYPES.has(mimeType)) {
        return await this.thumbnailImage(data, width, height);
      }

      // SVG — HTML <img> with base64 data URI → screenshot
      if (mimeType === 'image/svg+xml') {
        return await this.thumbnailSvg(data, width, height, fileName);
      }

      // Markdown — Gotenberg native /forms/chromium/screenshot/markdown endpoint
      if (mimeType === 'text/markdown') {
        return await this.thumbnailMarkdown(data, width, height, fileName);
      }

      // HTML — Chromium screenshot directly
      if (mimeType === 'text/html') {
        return await this.thumbnailHtml(data, width, height, fileName);
      }

      // CSV — parse to HTML table → screenshot
      if (mimeType === 'text/csv') {
        return await this.thumbnailCsv(data, width, height, fileName);
      }

      // Text/JSON/XML/YAML — styled monospace HTML → screenshot
      if (
        mimeType === 'text/plain' ||
        mimeType === 'application/json' ||
        mimeType === 'text/xml' ||
        mimeType === 'application/xml' ||
        mimeType === 'text/yaml'
      ) {
        return await this.thumbnailCode(data, width, height, fileName);
      }

      // PDF — base64-embedded in HTML <embed>, Chromium screenshot
      if (mimeType === PDF_TYPE) {
        return await this.thumbnailPdf(data, width, height, fileName);
      }

      // Office (DOCX/XLSX/PPTX) — LibreOffice→PDF, then PDF path
      if (GOTENBERG_OFFICE_TYPES.has(mimeType)) {
        return await this.thumbnailOffice(data, mimeType, width, height, fileName);
      }

      // Unknown type — branded extension card
      return await this.screenshotFallbackCard(fileName, width, height);
    } catch (error) {
      console.error(
        `[GotenbergProvider] generateThumbnailPng failed for ${fileName} (${mimeType}):`,
        error
      );
      try {
        return await this.screenshotFallbackCard(fileName, width, height);
      } catch {
        return await this.sharpSvgPlaceholder(fileName, width, height);
      }
    }
  }

  // ===========================================================================
  // Thumbnail per-type methods
  // ===========================================================================

  private async thumbnailImage(data: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(data).resize(width, height, { fit: 'cover', position: 'top' }).png().toBuffer();
  }

  private async thumbnailSvg(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      const svgBase64 = data.toString('base64');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{width:${width * 2}px;height:${height * 2}px;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden}
img{max-width:100%;max-height:100%;object-fit:contain}</style>
</head><body><img src="data:image/svg+xml;base64,${svgBase64}"/></body></html>`;

      const png = await this.gotenbergScreenshot(html, width * 2, height * 2);
      return await sharp(png)
        .resize(width, height, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();
    } catch {
      // Fallback: Sharp can convert SVGs directly
      try {
        return await sharp(data)
          .resize(width, height, { fit: 'cover', position: 'top' })
          .png()
          .toBuffer();
      } catch {
        return await this.screenshotFallbackCard(fileName, width, height);
      }
    }
  }

  private async thumbnailMarkdown(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      // Use Gotenberg's native /forms/chromium/screenshot/markdown endpoint.
      // html: false is a security requirement — content only renders in Gotenberg sandbox
      const mdContent = data.toString('utf-8').slice(0, 5000);
      const templateHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;max-width:${width * 2}px;margin:20px auto;padding:0 16px;line-height:1.5;color:#333;font-size:13px}
pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto;font-size:11px}
code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:0.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px;text-align:left;font-size:12px}
th{background:#f5f5f5}blockquote{border-left:3px solid #ddd;margin:0;padding-left:12px;color:#666}
h1{font-size:20px}h2{font-size:17px}h3{font-size:15px}
img{max-width:100%}</style>
</head><body>{{ toHTML "body.md" }}</body></html>`;

      const png = await this.gotenbergMarkdownScreenshot(
        mdContent,
        templateHtml,
        width * 2,
        height * 2
      );
      return await sharp(png)
        .resize(width, height, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();
    } catch {
      return await this.screenshotFallbackCard(fileName, width, height);
    }
  }

  private async thumbnailHtml(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      const htmlContent = data.toString('utf-8');
      const png = await this.gotenbergScreenshot(htmlContent, width * 2, height * 2);
      return await sharp(png)
        .resize(width, height, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();
    } catch {
      return await this.screenshotFallbackCard(fileName, width, height);
    }
  }

  private async thumbnailCsv(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      const csvText = data.toString('utf-8').slice(0, 5000);
      const rows = csvText.split('\n').slice(0, 30);
      const tableRows = rows
        .map((row, i) => {
          const cells = row.split(',').map((cell) => this.escapeHtml(cell.trim()));
          const tag = i === 0 ? 'th' : 'td';
          return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
        })
        .join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{width:${width * 2}px;padding:12px;background:#fff;font-family:system-ui,sans-serif;font-size:11px}
table{border-collapse:collapse;width:100%}
th{background:#f1f5f9;font-weight:600;text-align:left;padding:6px 8px;border:1px solid #e2e8f0;font-size:11px}
td{padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
tr:nth-child(even) td{background:#f8fafc}</style>
</head><body><table>${tableRows}</table></body></html>`;

      const png = await this.gotenbergScreenshot(html, width * 2, height * 2);
      return await sharp(png)
        .resize(width, height, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();
    } catch {
      return await this.screenshotFallbackCard(fileName, width, height);
    }
  }

  private async thumbnailCode(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      const text = data.toString('utf-8').slice(0, 4000);
      const escaped = this.escapeHtml(text);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{width:${width * 2}px;padding:16px;background:#fff;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:11px;line-height:1.5;color:#333;white-space:pre-wrap;word-break:break-all;overflow:hidden}
</style></head><body>${escaped}</body></html>`;

      const png = await this.gotenbergScreenshot(html, width * 2, height * 2);
      return await sharp(png)
        .resize(width, height, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();
    } catch {
      return await this.screenshotFallbackCard(fileName, width, height);
    }
  }

  private async thumbnailPdf(
    data: Buffer,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      // Approach A: base64-embedded PDF in HTML <embed>, Chromium screenshot
      const pdfBase64 = data.toString('base64');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}body{width:${width * 2}px;height:${height * 2}px;overflow:hidden}
embed{width:100%;height:100%}</style>
</head><body><embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="${width * 2}" height="${height * 2}"/></body></html>`;

      const png = await this.gotenbergScreenshot(html, width * 2, height * 2);
      if (png.length > 1000) {
        return await sharp(png)
          .resize(width, height, { fit: 'cover', position: 'top' })
          .png()
          .toBuffer();
      }
    } catch {
      // PDF embed approach failed
    }

    // Fallback to branded card for PDFs
    return await this.screenshotFallbackCard(fileName, width, height);
  }

  private async thumbnailOffice(
    data: Buffer,
    mimeType: string,
    width: number,
    height: number,
    fileName: string
  ): Promise<Buffer> {
    try {
      // Convert Office → PDF via LibreOffice
      const extension = MIME_TO_EXTENSION[mimeType] ?? '.bin';
      const docFilename = `document${extension}`;
      const boundary = `----GotenbergBoundary${Date.now()}`;
      const body = this.buildMultipartBody(boundary, docFilename, data);

      const response = await fetch(`${this.gotenbergUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`LibreOffice conversion failed (${response.status})`);
      }

      const pdfBuffer = Buffer.from(await response.arrayBuffer());
      // Now render the PDF thumbnail
      return await this.thumbnailPdf(pdfBuffer, width, height, fileName);
    } catch {
      return await this.screenshotFallbackCard(fileName, width, height);
    }
  }

  // ===========================================================================
  // Shared Gotenberg helpers
  // ===========================================================================

  /**
   * Take a Chromium screenshot of HTML content via Gotenberg.
   */
  private async gotenbergScreenshot(
    html: string,
    viewportWidth: number = 800,
    viewportHeight: number = 600
  ): Promise<Buffer> {
    const boundary = `----GotenbergBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const body = this.buildMultipartBodyWithFields(
      boundary,
      'index.html',
      Buffer.from(html, 'utf-8'),
      {
        width: String(viewportWidth),
        height: String(viewportHeight),
        format: 'png',
        optimizeForSpeed: 'true',
      }
    );

    const response = await fetch(`${this.gotenbergUrl}/forms/chromium/screenshot/html`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Gotenberg screenshot failed (${response.status}): ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Use Gotenberg's native /forms/chromium/screenshot/markdown endpoint.
   * Gotenberg parses the markdown internally — no markdown-it dependency needed.
   */
  private async gotenbergMarkdownScreenshot(
    mdContent: string,
    templateHtml: string,
    viewportWidth: number = 800,
    viewportHeight: number = 600
  ): Promise<Buffer> {
    const boundary = `----GotenbergBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;

    // Build multipart body with both index.html (template) and body.md (content)
    const parts: Buffer[] = [];

    // HTML template file
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="index.html"\r\n` +
          `Content-Type: text/html\r\n\r\n`
      )
    );
    parts.push(Buffer.from(templateHtml, 'utf-8'));
    parts.push(Buffer.from('\r\n'));

    // Markdown body file
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="body.md"\r\n` +
          `Content-Type: text/markdown\r\n\r\n`
      )
    );
    parts.push(Buffer.from(mdContent, 'utf-8'));
    parts.push(Buffer.from('\r\n'));

    // Screenshot parameters
    const fields: Record<string, string> = {
      width: String(viewportWidth),
      height: String(viewportHeight),
      format: 'png',
      optimizeForSpeed: 'true',
    };
    for (const [key, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${value}\r\n`
        )
      );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const response = await fetch(`${this.gotenbergUrl}/forms/chromium/screenshot/markdown`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Gotenberg markdown screenshot failed (${response.status}): ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Render a branded placeholder card via Gotenberg Chromium screenshot.
   * Shows the file extension in a color-coded card with the filename.
   */
  private async screenshotFallbackCard(
    fileName: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
    const color = EXTENSION_COLORS[ext] || { bg: '#f9fafb', text: '#6b7280' };
    const truncatedName = fileName.length > 30 ? fileName.slice(0, 27) + '...' : fileName;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{width:${width * 2}px;height:${height * 2}px;display:flex;align-items:center;justify-content:center;background:${color.bg};font-family:system-ui,-apple-system,sans-serif}
.card{text-align:center;padding:20px}
.ext{font-size:48px;font-weight:700;color:${color.text};letter-spacing:2px;margin-bottom:8px}
.name{font-size:13px;color:#6b7280;max-width:${width * 2 - 40}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head>
<body><div class="card"><div class="ext">${this.escapeHtml(ext)}</div><div class="name">${this.escapeHtml(truncatedName)}</div></div></body></html>`;

    const png = await this.gotenbergScreenshot(html, width * 2, height * 2);
    return await sharp(png)
      .resize(width, height, { fit: 'cover', position: 'top' })
      .png()
      .toBuffer();
  }

  /**
   * Last-resort fallback: generate a placeholder entirely via Sharp SVG.
   * Used when Gotenberg is unreachable.
   */
  private async sharpSvgPlaceholder(
    fileName: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
    const color = EXTENSION_COLORS[ext] || { bg: '#f9fafb', text: '#6b7280' };
    const truncatedName = fileName.length > 25 ? fileName.slice(0, 22) + '...' : fileName;

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${color.bg}" rx="4"/>
      <text x="50%" y="42%" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="28" font-weight="700" fill="${color.text}">${this.escapeHtml(ext)}</text>
      <text x="50%" y="62%" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="10" fill="#6b7280">${this.escapeHtml(truncatedName)}</text>
    </svg>`;

    return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
  }

  // ===========================================================================
  // Existing convert() methods (unchanged)
  // ===========================================================================

  /**
   * Convert office documents via Gotenberg's LibreOffice route
   */
  private async convertViaGotenbergOffice(
    data: Buffer,
    mimeType: string,
    _maxPages: number
  ): Promise<PreviewResult> {
    const extension = MIME_TO_EXTENSION[mimeType] ?? '.bin';
    const filename = `document${extension}`;

    // Build multipart form data for Gotenberg
    const boundary = `----GotenbergBoundary${Date.now()}`;
    const body = this.buildMultipartBody(boundary, filename, data);

    const response = await fetch(`${this.gotenbergUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Gotenberg conversion failed (${response.status}): ${errorText}`);
    }

    // Gotenberg returns a PDF — store it as the preview asset AND
    // rasterize to PNG via Chromium screenshot for thumbnails
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    // Try to rasterize the first page to PNG using Chromium
    let pngBuffer: Buffer | null = null;
    try {
      // Wrap PDF in HTML for Chromium to screenshot
      const htmlWrapper = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>body{margin:0;padding:0;overflow:hidden}embed{width:100%;height:100%}</style>
        </head><body><embed src="data:application/pdf;base64,${pdfBuffer.toString('base64')}" type="application/pdf" width="800" height="1100"/></body></html>`;
      const screenshotBoundary = `----GotenbergBoundary${Date.now()}ss`;
      const screenshotBody = this.buildMultipartBody(
        screenshotBoundary,
        'index.html',
        Buffer.from(htmlWrapper, 'utf-8')
      );
      const ssResponse = await fetch(`${this.gotenbergUrl}/forms/chromium/screenshot/html`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${screenshotBoundary}`,
        },
        body: new Uint8Array(screenshotBody),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (ssResponse.ok) {
        pngBuffer = Buffer.from(await ssResponse.arrayBuffer());
      }
    } catch {
      // Screenshot failed — fall back to PDF-only asset
    }

    // Return PNG if available, otherwise PDF
    if (pngBuffer && pngBuffer.length > 100) {
      return {
        pages: [
          {
            pageNumber: 1,
            data: pngBuffer,
            width: 800,
            height: 1100,
            mimeType: 'image/png',
          },
        ],
        totalPages: 1,
        mimeType: 'image/png',
      };
    }

    return {
      pages: [
        {
          pageNumber: 1,
          data: pdfBuffer,
          width: 800,
          height: 1100,
          mimeType: 'application/pdf',
        },
      ],
      totalPages: 1,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Convert SVG via Sharp
   */
  private async convertSvg(data: Buffer): Promise<PreviewResult> {
    const pngBuffer = await sharp(data).png().toBuffer();
    const metadata = await sharp(pngBuffer).metadata();
    return {
      pages: [
        {
          pageNumber: 1,
          data: pngBuffer,
          width: metadata.width ?? 800,
          height: metadata.height ?? 600,
          mimeType: 'image/png',
        },
      ],
      totalPages: 1,
      mimeType: 'image/png',
    };
  }

  /**
   * Convert HTML/Markdown via Gotenberg's Chromium route
   */
  private async convertViaGotenbergChromium(
    data: Buffer,
    mimeType: string,
    maxPages: number
  ): Promise<PreviewResult> {
    let htmlContent: string;

    const rawText = data.toString('utf-8');

    if (mimeType === 'text/markdown') {
      // Wrap markdown in basic HTML for Chromium rendering
      htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#333}
pre{background:#f5f5f5;padding:16px;border-radius:4px;overflow-x:auto}
code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:0.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f5f5f5}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}</style>
</head><body>${this.escapeHtml(rawText)}</body></html>`;
    } else if (mimeType === 'text/html') {
      htmlContent = rawText;
    } else {
      // JSON, XML, YAML — wrap in monospace code block
      htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{margin:20px;font-family:monospace;font-size:12px;line-height:1.5;color:#333;white-space:pre-wrap;word-break:break-all;background:#fff}</style>
</head><body>${this.escapeHtml(rawText.slice(0, 5000))}</body></html>`;
    }

    const boundary = `----GotenbergBoundary${Date.now()}`;
    const body = this.buildMultipartBody(boundary, 'index.html', Buffer.from(htmlContent, 'utf-8'));

    const response = await fetch(`${this.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Gotenberg Chromium conversion failed (${response.status}): ${errorText}`);
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    return this.convertPdfToPages(pdfBuffer, maxPages);
  }

  /**
   * Convert PDF to page-by-page PNG renders
   * Uses pdf-lib for page count, then Sharp for rasterization
   */
  private async convertPdfToPages(pdfBuffer: Buffer, maxPages: number): Promise<PreviewResult> {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    const pagesToRender = Math.min(totalPages, maxPages);
    const pages: PreviewPage[] = [];

    // For each page, create a single-page PDF then render via Sharp
    for (let i = 0; i < pagesToRender; i++) {
      try {
        const singlePageDoc = await PDFDocument.create();
        const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
        singlePageDoc.addPage(copiedPage);
        const singlePagePdf = await singlePageDoc.save();

        // Sharp can render PDFs (via libvips/poppler if available)
        // Fall back to placeholder if Sharp PDF rendering is unavailable
        let pageImage: Buffer;
        let width = 800;
        let height = 1100;

        try {
          const metadata = await sharp(Buffer.from(singlePagePdf), { density: 150 }).metadata();
          width = metadata.width ?? 800;
          height = metadata.height ?? 1100;
          pageImage = await sharp(Buffer.from(singlePagePdf), { density: 150 })
            .png({ quality: 90, compressionLevel: 6 })
            .toBuffer();
        } catch {
          // Sharp PDF rendering requires libvips with poppler support
          // Generate a placeholder page
          const page = pdfDoc.getPage(i);
          const pageSize = page.getSize();
          width = Math.round(pageSize.width * (150 / 72)); // Convert from points to pixels at 150 DPI
          height = Math.round(pageSize.height * (150 / 72));

          pageImage = await sharp({
            create: {
              width: Math.min(width, 1600),
              height: Math.min(height, 2200),
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
          })
            .composite([
              {
                input: Buffer.from(
                  `<svg width="${Math.min(width, 1600)}" height="${Math.min(height, 2200)}">
                    <rect width="100%" height="100%" fill="white" stroke="#e5e7eb" stroke-width="2"/>
                    <text x="50%" y="50%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" fill="#9ca3af">
                      Page ${i + 1}
                    </text>
                  </svg>`
                ),
                top: 0,
                left: 0,
              },
            ])
            .png()
            .toBuffer();
        }

        pages.push({
          pageNumber: i + 1,
          data: pageImage,
          width,
          height,
          mimeType: 'image/png',
        });
      } catch (pageError) {
        console.error(`[GotenbergProvider] Failed to render page ${i + 1}:`, pageError);
      }
    }

    return {
      pages,
      totalPages,
      mimeType: 'image/png',
    };
  }

  /**
   * Convert image to preview
   */
  private async convertImage(data: Buffer): Promise<PreviewResult> {
    const metadata = await sharp(data).metadata();
    const width = metadata.width ?? 800;
    const height = metadata.height ?? 600;

    const pngBuffer = await sharp(data).png({ quality: 90, compressionLevel: 6 }).toBuffer();

    return {
      pages: [{ pageNumber: 1, data: pngBuffer, width, height, mimeType: 'image/png' }],
      totalPages: 1,
      mimeType: 'image/png',
    };
  }

  /**
   * Convert plain text to preview image via Gotenberg Chromium screenshot
   */
  private async convertText(data: Buffer): Promise<PreviewResult> {
    const text = data.toString('utf-8').slice(0, 4000);
    const escapedText = this.escapeHtml(text);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{margin:20px;font-family:monospace;font-size:13px;line-height:1.5;color:#333;white-space:pre-wrap;word-break:break-all;background:#fff}</style>
      </head><body>${escapedText}</body></html>`;

    try {
      const boundary = `----GotenbergBoundary${Date.now()}`;
      const body = this.buildMultipartBody(boundary, 'index.html', Buffer.from(html, 'utf-8'));
      const response = await fetch(`${this.gotenbergUrl}/forms/chromium/screenshot/html`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) {
        const pngBuffer = Buffer.from(await response.arrayBuffer());
        return {
          pages: [
            { pageNumber: 1, data: pngBuffer, width: 800, height: 600, mimeType: 'image/png' },
          ],
          totalPages: 1,
          mimeType: 'image/png',
        };
      }
    } catch {
      // Gotenberg screenshot failed — fall back to Sharp SVG
    }

    // Fallback: simple white placeholder
    const pngBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    return {
      pages: [{ pageNumber: 1, data: pngBuffer, width: 800, height: 600, mimeType: 'image/png' }],
      totalPages: 1,
      mimeType: 'image/png',
    };
  }

  // ===========================================================================
  // Multipart helpers
  // ===========================================================================

  /**
   * Build multipart form data body for Gotenberg API (file only)
   */
  private buildMultipartBody(boundary: string, filename: string, data: Buffer): Buffer {
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return Buffer.concat([header, data, footer]);
  }

  /**
   * Build multipart form data body with additional form fields (for screenshot params).
   */
  private buildMultipartBodyWithFields(
    boundary: string,
    filename: string,
    data: Buffer,
    fields: Record<string, string> = {}
  ): Buffer {
    const parts: Buffer[] = [];

    // File part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`
      )
    );
    parts.push(data);
    parts.push(Buffer.from('\r\n'));

    // Field parts
    for (const [key, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${value}\r\n`
        )
      );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }

  /**
   * Basic HTML escaping
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
