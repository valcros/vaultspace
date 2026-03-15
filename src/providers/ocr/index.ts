/**
 * OCR Provider Module (F132)
 *
 * Exports OCR provider implementations for text extraction from images and scanned documents.
 */

export { TesseractOCRProvider } from './TesseractOCRProvider';

import type { OCRProvider, OCRResult } from '../types';
import { TesseractOCRProvider } from './TesseractOCRProvider';

/**
 * Create an OCR provider based on configuration
 */
export function createOCRProvider(): OCRProvider {
  const ocrEngine = process.env['OCR_ENGINE'] ?? 'tesseract';

  if (ocrEngine === 'tesseract') {
    return new TesseractOCRProvider({
      defaultLanguage: process.env['OCR_DEFAULT_LANGUAGE'] ?? 'eng',
    });
  }

  // Fallback stub for when OCR is disabled or not available
  return createStubOCRProvider();
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
