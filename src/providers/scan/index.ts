/**
 * Scan Provider Module
 *
 * Exports scan provider implementations for virus/malware detection.
 * Provider selection is based on environment configuration.
 */

import type { ScanProvider } from '../types';

import { ClamAVScanProvider } from './ClamAVScanProvider';
import { PassthroughScanProvider } from './PassthroughScanProvider';

/**
 * Create a scan provider based on configuration
 *
 * In production, auto-detects ClamAV if CLAMAV_HOST is configured.
 * Explicit SCAN_ENGINE setting always takes precedence.
 */
export function createScanProvider(): ScanProvider {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const explicitEngine = process.env['SCAN_ENGINE'];
  const clamavHost = process.env['CLAMAV_HOST'];

  // Determine which engine to use:
  // 1. Explicit SCAN_ENGINE always wins
  // 2. In production with CLAMAV_HOST, default to ClamAV
  // 3. Otherwise passthrough
  let scanEngine: string;
  if (explicitEngine) {
    scanEngine = explicitEngine;
  } else if (isProduction && clamavHost) {
    scanEngine = 'clamav';
    console.log('[ScanProvider] Auto-detected ClamAV configuration for production');
  } else {
    scanEngine = 'passthrough';
  }

  switch (scanEngine) {
    case 'clamav': {
      const host = clamavHost ?? 'localhost';
      const port = parseInt(process.env['CLAMAV_PORT'] ?? '3310', 10);
      const timeout = parseInt(process.env['CLAMAV_TIMEOUT'] ?? '30000', 10);
      // Files larger than this are allowed but flagged unscanned (SKIPPED). Must
      // stay <= clamd's StreamMaxLength; raise both together to scan bigger files.
      // Validate strictly: this gates whether scanning happens, so a bad value
      // must fail loudly rather than silently disable scanning. Number() (not
      // parseInt) rejects partials like "25MB" instead of reading them as 25.
      const rawMaxSize = process.env['CLAMAV_MAX_SCAN_BYTES'];
      const maxSize = rawMaxSize === undefined ? 25 * 1024 * 1024 : Number(rawMaxSize);
      if (!Number.isInteger(maxSize) || maxSize <= 0) {
        throw new Error(
          `CLAMAV_MAX_SCAN_BYTES must be a positive integer number of bytes (got: ${rawMaxSize})`
        );
      }

      console.log(`[ScanProvider] Using ClamAV at ${host}:${port} (max scan ${maxSize} bytes)`);

      return new ClamAVScanProvider({
        host,
        port,
        timeout,
        maxSize,
      });
    }

    case 'passthrough':
    default: {
      if (isProduction) {
        console.warn(
          '[ScanProvider] WARNING: Passthrough scanner in production - files are NOT being scanned! ' +
            'Set CLAMAV_HOST to enable virus scanning.'
        );
      }
      return new PassthroughScanProvider();
    }
  }
}

export { ClamAVScanProvider } from './ClamAVScanProvider';
export { PassthroughScanProvider } from './PassthroughScanProvider';
