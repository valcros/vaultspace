/**
 * Tesseract OCR Provider (F132)
 *
 * Basic OCR for scanned documents using Tesseract.js.
 * Enables full-text search on image-based PDFs and scanned documents.
 */

import type { OCRProvider, OCROptions, OCRResult } from '../types';

interface TesseractWorker {
  recognize: (
    image: Buffer | string,
    options?: Record<string, unknown>
  ) => Promise<{
    data: {
      text: string;
      confidence: number;
    };
  }>;
  terminate: () => Promise<void>;
}

interface TesseractModule {
  createWorker: (lang?: string) => Promise<TesseractWorker>;
}

interface TesseractOCRProviderOptions {
  defaultLanguage?: string;
  cachePath?: string;
}

export class TesseractOCRProvider implements OCRProvider {
  private worker: TesseractWorker | null = null;
  private defaultLanguage: string;
  private initialized = false;
  private tesseract: TesseractModule | null = null;

  constructor(options: TesseractOCRProviderOptions = {}) {
    this.defaultLanguage = options.defaultLanguage ?? 'eng';
  }

  /**
   * Initialize the Tesseract worker lazily
   */
  private async getWorker(): Promise<TesseractWorker> {
    if (!this.worker) {
      try {
        // Dynamic import with webpack magic comment to exclude from bundle
        // @ts-expect-error - tesseract.js is an optional dependency
        const tesseractModule = await import(/* webpackIgnore: true */ 'tesseract.js').catch(() => null);
        if (!tesseractModule) {
          throw new Error('tesseract.js not installed');
        }
        this.tesseract = tesseractModule as unknown as TesseractModule;
        this.worker = await this.tesseract.createWorker(this.defaultLanguage);
        this.initialized = true;
      } catch (error) {
        console.error('[TesseractOCR] Failed to initialize:', error);
        throw new Error('OCR engine not available. Install tesseract.js for OCR support.');
      }
    }
    return this.worker;
  }

  /**
   * Extract text from an image or scanned document
   */
  async extractText(
    data: Buffer,
    mimeType: string,
    options: OCROptions = {}
  ): Promise<OCRResult> {
    // Check if the mime type is supported
    if (!this.isSupportedFormat(mimeType)) {
      return {
        text: '',
        confidence: 0,
        language: options.language ?? this.defaultLanguage,
      };
    }

    try {
      const worker = await this.getWorker();
      const result = await worker.recognize(data);

      return {
        text: result.data.text.trim(),
        confidence: result.data.confidence,
        language: options.language ?? this.defaultLanguage,
      };
    } catch (error) {
      console.error('[TesseractOCR] OCR failed:', error);
      return {
        text: '',
        confidence: 0,
        language: options.language ?? this.defaultLanguage,
      };
    }
  }

  /**
   * Check if a document needs OCR
   * For images, always return true
   * For PDFs, would need to detect if it's image-based (not implemented in basic version)
   */
  async requiresOCR(_data: Buffer, mimeType: string): Promise<boolean> {
    // Image formats always need OCR for text extraction
    const imageFormats = [
      'image/png',
      'image/jpeg',
      'image/tiff',
      'image/gif',
      'image/webp',
      'image/bmp',
    ];

    return imageFormats.includes(mimeType);
  }

  /**
   * Check if OCR engine is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getWorker();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a MIME type is supported for OCR
   */
  private isSupportedFormat(mimeType: string): boolean {
    const supportedFormats = [
      'image/png',
      'image/jpeg',
      'image/tiff',
      'image/gif',
      'image/webp',
      'image/bmp',
    ];
    return supportedFormats.includes(mimeType);
  }

  /**
   * Cleanup resources
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }
}
