/**
 * OCR Provider Module (F132)
 *
 * Exports OCR provider implementations for text extraction from images and scanned documents.
 * TesseractOCRProvider is loaded dynamically to avoid bundling tesseract.js when not needed.
 */

import type { OCRProvider, OCRResult } from '../types';

/**
 * Create an OCR provider based on configuration
 *
 * In production, defaults to Tesseract unless explicitly disabled.
 * Uses lazy-loading to avoid bundling overhead when not needed.
 */
export function createOCRProvider(): OCRProvider {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const explicitEngine = process.env['OCR_ENGINE'];

  // Determine which engine to use:
  // 1. Explicit OCR_ENGINE always wins ('tesseract', 'none', or 'stub')
  // 2. In production, default to Tesseract (lazy-loaded)
  // 3. In development, use stub to avoid Tesseract overhead
  let useOCR: boolean;
  if (explicitEngine) {
    useOCR = explicitEngine === 'tesseract';
  } else if (isProduction) {
    useOCR = true;
    console.log('[OCRProvider] Enabling Tesseract OCR for production (lazy-loaded)');
  } else {
    useOCR = false;
  }

  if (!useOCR) {
    if (isProduction && explicitEngine !== 'none') {
      console.warn('[OCRProvider] OCR disabled in production - set OCR_ENGINE=tesseract to enable');
    }
    return createStubOCRProvider();
  }

  // Return a lazy-loading wrapper that loads Tesseract on first use
  return createLazyTesseractProvider();
}

/**
 * Stub OCR provider for development without Tesseract
 */
function createStubOCRProvider(): OCRProvider {
  return {
    async extractText(): Promise<OCRResult> {
      return {
        text: '',
        confidence: 0,
        language: 'eng',
      };
    },

    async requiresOCR(): Promise<boolean> {
      return false;
    },

    async isAvailable(): Promise<boolean> {
      return false;
    },
  };
}

/**
 * Lazy-loading Tesseract provider
 * Only loads tesseract.js when OCR is actually used
 */
function createLazyTesseractProvider(): OCRProvider {
  let realProvider: OCRProvider | null = null;
  let loadAttempted = false;

  const loadProvider = async (): Promise<OCRProvider> => {
    if (realProvider) {
      return realProvider;
    }
    if (loadAttempted) {
      return createStubOCRProvider();
    }

    loadAttempted = true;

    try {
      // Dynamic import with webpack magic comment to exclude from bundle
      const tesseractModule = await import(/* webpackIgnore: true */ './TesseractOCRProvider');
      const TesseractOCRProvider = tesseractModule.TesseractOCRProvider;
      realProvider = new TesseractOCRProvider({
        defaultLanguage: process.env['OCR_DEFAULT_LANGUAGE'] ?? 'eng',
      });
      return realProvider;
    } catch (error) {
      console.warn('[OCR] Failed to load Tesseract:', error);
      return createStubOCRProvider();
    }
  };

  return {
    async extractText(data, mimeType, options): Promise<OCRResult> {
      const provider = await loadProvider();
      return provider.extractText(data, mimeType, options);
    },

    async requiresOCR(data, mimeType): Promise<boolean> {
      const provider = await loadProvider();
      return provider.requiresOCR(data, mimeType);
    },

    async isAvailable(): Promise<boolean> {
      const provider = await loadProvider();
      return provider.isAvailable();
    },
  };
}
