/**
 * Sharp Preview Provider
 *
 * Uses Sharp for image processing and PDF preview generation.
 * Supports common image formats and basic PDF rendering.
 */

import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

import type { PreviewOptions, PreviewPage, PreviewProvider, PreviewResult } from '../types';

// Supported MIME types for preview generation
const SUPPORTED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  // PDFs
  'application/pdf',
  // Text files (converted to image)
  'text/plain',
]);

export class SharpPreviewProvider implements PreviewProvider {
  async convert(
    data: Buffer,
    mimeType: string,
    options: PreviewOptions = {}
  ): Promise<PreviewResult> {
    const format = options.format ?? 'png';
    const quality = options.quality ?? 90;
    const dpi = options.dpi ?? 150;
    const maxPages = options.maxPages ?? 50;

    if (mimeType === 'application/pdf') {
      return this.convertPdf(data, format, quality, dpi, maxPages);
    }

    if (mimeType.startsWith('image/')) {
      return this.convertImage(data, mimeType, format, quality);
    }

    if (mimeType === 'text/plain') {
      return this.convertText(data, format, quality);
    }

    throw new Error(`Unsupported MIME type for preview: ${mimeType}`);
  }

  async generateThumbnail(
    data: Buffer,
    mimeType: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    // For PDFs, extract first page as image first
    if (mimeType === 'application/pdf') {
      // Return a placeholder thumbnail for PDFs
      // In production, you'd use a PDF renderer like pdf.js or poppler
      return this.generatePlaceholderThumbnail(width, height, 'PDF');
    }

    // For images, resize directly
    if (mimeType.startsWith('image/')) {
      return sharp(data)
        .resize(width, height, {
          fit: 'cover',
          position: 'top',
        })
        .png()
        .toBuffer();
    }

    // For other types, generate a placeholder
    return this.generatePlaceholderThumbnail(width, height, 'FILE');
  }

  /**
   * Generate a PNG thumbnail directly from original file bytes.
   * Sharp-only fallback: resizes images directly, SVG placeholder for everything else.
   * Never throws.
   */
  async generateThumbnailPng(
    data: Buffer,
    mimeType: string,
    fileName: string,
    width: number,
    height: number
  ): Promise<Buffer> {
    try {
      // Images — Sharp resize directly
      if (mimeType.startsWith('image/')) {
        return await sharp(data)
          .resize(width, height, { fit: 'cover', position: 'top' })
          .png()
          .toBuffer();
      }
    } catch {
      // Fall through to placeholder
    }

    // Everything else — SVG placeholder
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
    const truncatedName = fileName.length > 25 ? fileName.slice(0, 22) + '...' : fileName;
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f5f5f5" rx="4"/>
      <text x="50%" y="42%" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="28" font-weight="700" fill="#6b7280">${this.escapeXml(ext)}</text>
      <text x="50%" y="62%" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="10" fill="#9ca3af">${this.escapeXml(truncatedName)}</text>
    </svg>`;

    return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
  }

  isSupported(mimeType: string): boolean {
    return SUPPORTED_MIME_TYPES.has(mimeType);
  }

  private async convertPdf(
    data: Buffer,
    format: string,
    _quality: number,
    _dpi: number,
    maxPages: number
  ): Promise<PreviewResult> {
    // Load the PDF to get page count and dimensions
    const pdfDoc = await PDFDocument.load(data, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    const pageCount = Math.min(totalPages, maxPages);

    // If PDF format requested, return the original PDF (possibly truncated)
    if (format === 'pdf') {
      let outputPdf = data;

      // If we need to truncate pages, create a new PDF with only the first maxPages
      if (totalPages > maxPages) {
        const newPdf = await PDFDocument.create();
        const pages = await newPdf.copyPages(
          pdfDoc,
          Array.from({ length: maxPages }, (_, i) => i)
        );
        pages.forEach((page) => newPdf.addPage(page));
        outputPdf = Buffer.from(await newPdf.save());
      }

      // Get first page dimensions for metadata
      const firstPage = pdfDoc.getPage(0);
      const { width, height } = firstPage.getSize();

      return {
        pages: [
          {
            pageNumber: 1,
            data: outputPdf,
            width: Math.round(width),
            height: Math.round(height),
            mimeType: 'application/pdf',
          },
        ],
        totalPages,
        mimeType: 'application/pdf',
      };
    }

    // For image formats, generate placeholder images for each page
    // In production, use pdf.js or poppler for real rendering
    const pages: PreviewPage[] = [];
    const imageFormat = format === 'jpeg' ? 'jpeg' : 'png';

    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();

      // Create a placeholder image for each page
      const pageImage = await this.generatePlaceholderPage(
        Math.round(width),
        Math.round(height),
        i + 1
      );

      pages.push({
        pageNumber: i + 1,
        data: pageImage,
        width: Math.round(width),
        height: Math.round(height),
        mimeType: `image/${imageFormat}`,
      });
    }

    return {
      pages,
      totalPages,
      mimeType: pages.length > 0 ? `image/${imageFormat}` : 'application/pdf',
    };
  }

  private async convertImage(
    data: Buffer,
    _originalMimeType: string,
    format: string,
    quality: number
  ): Promise<PreviewResult> {
    const metadata = await sharp(data).metadata();
    const width = metadata.width ?? 800;
    const height = metadata.height ?? 600;

    let sharpInstance = sharp(data);

    // Determine actual output format - images can only produce image formats, not PDF
    // When PDF is requested, we produce PNG as the closest equivalent
    const actualFormat = format === 'pdf' ? 'png' : format === 'jpeg' ? 'jpeg' : 'png';

    // Apply format conversion
    switch (actualFormat) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({ quality });
        break;
      case 'png':
      default:
        sharpInstance = sharpInstance.png({ quality: Math.round(quality / 10) });
        break;
    }

    const outputBuffer = await sharpInstance.toBuffer();

    return {
      pages: [
        {
          pageNumber: 1,
          data: outputBuffer,
          width,
          height,
          mimeType: `image/${actualFormat}`,
        },
      ],
      totalPages: 1,
      mimeType: `image/${actualFormat}`,
    };
  }

  private async convertText(
    data: Buffer,
    _format: string,
    _quality: number
  ): Promise<PreviewResult> {
    const text = data.toString('utf-8').substring(0, 2000);
    const lines = text.split('\n').slice(0, 40);

    // Create a simple text preview image
    const width = 800;
    const lineHeight = 18;
    const padding = 20;
    const height = Math.max(100, lines.length * lineHeight + padding * 2);

    // Generate SVG text preview
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <text x="${padding}" y="${padding}" font-family="monospace" font-size="14" fill="#333">
          ${lines
            .map(
              (line, i) =>
                `<tspan x="${padding}" dy="${i === 0 ? 0 : lineHeight}">${this.escapeXml(line.substring(0, 100))}</tspan>`
            )
            .join('')}
        </text>
      </svg>
    `;

    // Text previews always output PNG (the actual format Sharp produces)
    const outputBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return {
      pages: [
        {
          pageNumber: 1,
          data: outputBuffer,
          width,
          height,
          mimeType: 'image/png',
        },
      ],
      totalPages: 1,
      mimeType: 'image/png',
    };
  }

  private async generatePlaceholderThumbnail(
    width: number,
    height: number,
    label: string
  ): Promise<Buffer> {
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f5f5f5"/>
        <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#ddd" stroke-width="2"/>
        <text x="50%" y="50%" font-family="Arial" font-size="14" fill="#888" text-anchor="middle" dominant-baseline="middle">${label}</text>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private async generatePlaceholderPage(
    width: number,
    height: number,
    pageNumber: number
  ): Promise<Buffer> {
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#ddd" stroke-width="1"/>
        <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#ccc" text-anchor="middle" dominant-baseline="middle">Page ${pageNumber}</text>
        <text x="50%" y="60%" font-family="Arial" font-size="12" fill="#999" text-anchor="middle" dominant-baseline="middle">(Preview placeholder)</text>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
