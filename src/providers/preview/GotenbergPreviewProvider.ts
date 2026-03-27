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
const GOTENBERG_CHROMIUM_TYPES = new Set(['text/html', 'text/markdown']);

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
      mimeType === PDF_TYPE
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
    mimeType: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    return sharp(data).resize(width, height, { fit: 'cover', position: 'top' }).png().toBuffer();
  }

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

    // Return the converted PDF directly as a single-page preview asset
    // The browser's PDF viewer or react-pdf will render it — no Sharp rasterization needed
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
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
   * Convert HTML/Markdown via Gotenberg's Chromium route
   */
  private async convertViaGotenbergChromium(
    data: Buffer,
    mimeType: string,
    maxPages: number
  ): Promise<PreviewResult> {
    let htmlContent: string;

    if (mimeType === 'text/markdown') {
      // Wrap markdown in basic HTML for Chromium rendering
      const mdText = data.toString('utf-8');
      htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#333}
pre{background:#f5f5f5;padding:16px;border-radius:4px;overflow-x:auto}
code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:0.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f5f5f5}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}</style>
</head><body>${this.escapeHtml(mdText)}</body></html>`;
    } else {
      htmlContent = data.toString('utf-8');
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
   * Convert plain text to preview image
   */
  private async convertText(data: Buffer): Promise<PreviewResult> {
    const text = data.toString('utf-8').slice(0, 4000);
    const lines = text.split('\n').slice(0, 60);
    const escapedLines = lines.map((l) => this.escapeHtml(l.slice(0, 120)));

    const width = 800;
    const lineHeight = 18;
    const height = Math.max(200, Math.min(lines.length * lineHeight + 80, 1200));

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <style>text { font-family: 'Courier New', monospace; font-size: 13px; fill: #333; }</style>
      ${escapedLines.map((line, i) => `<text x="20" y="${40 + i * lineHeight}">${line || ' '}</text>`).join('\n')}
    </svg>`;

    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return {
      pages: [{ pageNumber: 1, data: pngBuffer, width, height, mimeType: 'image/png' }],
      totalPages: 1,
      mimeType: 'image/png',
    };
  }

  /**
   * Build multipart form data body for Gotenberg API
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
