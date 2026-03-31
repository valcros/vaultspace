/**
 * Preview Provider Module
 *
 * Exports preview provider implementations for document conversion and thumbnails.
 * Provider selection is based on environment configuration.
 */

import type { PreviewProvider, PreviewResult } from '../types';

import { GotenbergPreviewProvider } from './GotenbergPreviewProvider';
import { SharpPreviewProvider } from './SharpPreviewProvider';

/**
 * Create a preview provider based on configuration
 */
export function createPreviewProvider(): PreviewProvider {
  const previewEngine = process.env['PREVIEW_ENGINE'] ?? 'sharp';

  switch (previewEngine) {
    case 'gotenberg': {
      const gotenbergUrl = process.env['GOTENBERG_URL'] ?? 'http://gotenberg:3000';
      console.log(`[PreviewProvider] Using Gotenberg preview generator (${gotenbergUrl})`);
      return new GotenbergPreviewProvider(gotenbergUrl);
    }
    case 'sharp':
    default: {
      console.log('[PreviewProvider] Using Sharp-based preview generator');
      return new SharpPreviewProvider();
    }
  }
}

/**
 * Stub preview provider for when preview generation is disabled
 */
export function createStubPreviewProvider(): PreviewProvider {
  return {
    async convert(): Promise<PreviewResult> {
      return {
        pages: [],
        totalPages: 0,
        mimeType: 'application/octet-stream',
      };
    },

    async generateThumbnail(): Promise<Buffer> {
      return Buffer.alloc(0);
    },

    async generateThumbnailPng(): Promise<Buffer> {
      return Buffer.alloc(0);
    },

    isSupported(): boolean {
      return false;
    },
  };
}

export { GotenbergPreviewProvider } from './GotenbergPreviewProvider';
export { SharpPreviewProvider } from './SharpPreviewProvider';
