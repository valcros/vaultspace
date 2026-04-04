/**
 * PDF Rasterizer Helper
 *
 * Uses poppler-utils (pdftoppm) for PDF page rasterization.
 * This provides a reliable fallback when Sharp/libvips PDF support is unavailable.
 *
 * Security: Uses execFile (not exec) to prevent shell injection.
 * Temp files are cleaned up in finally blocks.
 */

import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

import sharp from 'sharp';

const execFileAsync = promisify(execFile);

// Hard timeout for pdftoppm execution (30 seconds)
const PDFTOPPM_TIMEOUT_MS = 30000;

// Default DPI for rasterization
const DEFAULT_DPI = 150;

export interface RasterizeResult {
  image: Buffer;
  width: number;
  height: number;
}

export class PdfRasterizer {
  private dpi: number;

  constructor(dpi: number = DEFAULT_DPI) {
    this.dpi = dpi;
  }

  /**
   * Check if pdftoppm is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('pdftoppm', ['-v'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rasterize a specific page of a PDF to PNG.
   *
   * @param pdfBuffer - The PDF file as a Buffer
   * @param pageNumber - 1-indexed page number to render
   * @param dpi - Optional DPI override (default: 150)
   * @returns PNG image buffer with dimensions
   */
  async rasterizePage(
    pdfBuffer: Buffer,
    pageNumber: number = 1,
    dpi?: number
  ): Promise<RasterizeResult> {
    const effectiveDpi = dpi ?? this.dpi;
    let tempDir: string | null = null;

    try {
      // Create bounded temp directory
      tempDir = await mkdtemp(path.join(tmpdir(), 'vaultspace-pdf-'));
      const inputPath = path.join(tempDir, 'input.pdf');
      const outputPrefix = path.join(tempDir, 'page');

      // Write PDF to temp file
      await writeFile(inputPath, pdfBuffer);

      // Run pdftoppm with execFile (no shell injection risk)
      // -png: output PNG format
      // -r: resolution in DPI
      // -f/-l: first/last page (same value = single page)
      // -singlefile: output single file without page number suffix
      await execFileAsync(
        'pdftoppm',
        [
          '-png',
          '-r',
          String(effectiveDpi),
          '-f',
          String(pageNumber),
          '-l',
          String(pageNumber),
          '-singlefile',
          inputPath,
          outputPrefix,
        ],
        { timeout: PDFTOPPM_TIMEOUT_MS }
      );

      // Read the output PNG (pdftoppm creates outputPrefix.png)
      const outputPath = `${outputPrefix}.png`;
      const pngBuffer = await readFile(outputPath);

      // Get dimensions using Sharp
      const metadata = await sharp(pngBuffer).metadata();

      return {
        image: pngBuffer,
        width: metadata.width ?? 800,
        height: metadata.height ?? 1100,
      };
    } finally {
      // Always clean up temp directory
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Rasterize multiple pages of a PDF to PNG.
   *
   * @param pdfBuffer - The PDF file as a Buffer
   * @param startPage - First page to render (1-indexed)
   * @param endPage - Last page to render (inclusive)
   * @param dpi - Optional DPI override
   * @returns Array of PNG buffers with dimensions
   */
  async rasterizePages(
    pdfBuffer: Buffer,
    startPage: number,
    endPage: number,
    dpi?: number
  ): Promise<RasterizeResult[]> {
    const results: RasterizeResult[] = [];

    for (let page = startPage; page <= endPage; page++) {
      try {
        const result = await this.rasterizePage(pdfBuffer, page, dpi);
        results.push(result);
      } catch (error) {
        console.error(`[PdfRasterizer] Failed to rasterize page ${page}:`, error);
        // Continue with other pages rather than failing entirely
      }
    }

    return results;
  }
}
