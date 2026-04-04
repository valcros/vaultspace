/**
 * Ghostscript Converter Helper
 *
 * Converts EPS and Adobe Illustrator (AI) files to PNG using Ghostscript.
 * Ghostscript is required for these vector formats as they use PostScript.
 *
 * Security:
 * - Uses execFile (not exec) to prevent shell injection
 * - Always uses -dSAFER flag to restrict file system access
 * - Temp files are cleaned up in finally blocks
 */

import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Hard timeout for Ghostscript execution (60 seconds - can be slow for complex files)
const GS_TIMEOUT_MS = 60000;

// Default resolution for rasterization
const DEFAULT_RESOLUTION = 150;

/**
 * MIME types supported by Ghostscript converter.
 * Includes all variants for EPS and Adobe Illustrator.
 */
export const GHOSTSCRIPT_SUPPORTED_TYPES = new Set([
  // EPS variants
  'application/postscript',
  'application/eps',
  'application/x-eps',
  'image/x-eps',
  'image/eps',
  // Adobe Illustrator variants
  'application/illustrator',
  'application/x-illustrator',
  'application/vnd.adobe.illustrator',
]);

export class GhostscriptConverter {
  /**
   * Static accessor for supported MIME types.
   */
  static readonly SUPPORTED_TYPES = GHOSTSCRIPT_SUPPORTED_TYPES;

  private resolution: number;

  constructor(resolution: number = DEFAULT_RESOLUTION) {
    this.resolution = resolution;
  }

  /**
   * Check if Ghostscript is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gs', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a MIME type is supported by this converter.
   */
  static isSupported(mimeType: string): boolean {
    return GHOSTSCRIPT_SUPPORTED_TYPES.has(mimeType);
  }

  /**
   * Convert EPS or AI file to PNG.
   *
   * @param data - The file content as a Buffer
   * @param mimeType - The MIME type of the input file
   * @param resolution - Optional resolution override (default: 150 DPI)
   * @returns PNG buffer, or null if conversion fails
   */
  async convert(data: Buffer, mimeType: string, resolution?: number): Promise<Buffer | null> {
    if (!GHOSTSCRIPT_SUPPORTED_TYPES.has(mimeType)) {
      throw new Error(`Unsupported MIME type for Ghostscript: ${mimeType}`);
    }

    const effectiveResolution = resolution ?? this.resolution;
    let tempDir: string | null = null;

    try {
      // Create bounded temp directory
      tempDir = await mkdtemp(path.join(tmpdir(), 'vaultspace-gs-'));

      // Determine input extension based on MIME type
      const inputExt = this.getExtensionForMime(mimeType);
      const inputPath = path.join(tempDir, `input${inputExt}`);
      const outputPath = path.join(tempDir, 'output.png');

      // Write input file
      await writeFile(inputPath, data);

      // Run Ghostscript with security flags
      // -dSAFER: Restricts file operations (MANDATORY for security)
      // -dBATCH: Exit after processing
      // -dNOPAUSE: Don't pause between pages
      // -sDEVICE=png16m: 24-bit PNG output
      // -r: Resolution in DPI
      // -dTextAlphaBits/dGraphicsAlphaBits: Anti-aliasing
      await execFileAsync(
        'gs',
        [
          '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-dNOPROMPT',
          '-sDEVICE=png16m',
          `-r${effectiveResolution}`,
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          `-sOutputFile=${outputPath}`,
          inputPath,
        ],
        { timeout: GS_TIMEOUT_MS }
      );

      // Read the output PNG
      const pngBuffer = await readFile(outputPath);
      return pngBuffer;
    } catch (error) {
      console.error('[GhostscriptConverter] Conversion failed:', error);
      return null;
    } finally {
      // Always clean up temp directory
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Get appropriate file extension for a MIME type.
   */
  private getExtensionForMime(mimeType: string): string {
    // Adobe Illustrator files
    if (
      mimeType === 'application/illustrator' ||
      mimeType === 'application/x-illustrator' ||
      mimeType === 'application/vnd.adobe.illustrator'
    ) {
      return '.ai';
    }
    // Default to EPS for PostScript variants
    return '.eps';
  }
}
