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
 */
export function createScanProvider(): ScanProvider {
  const scanEngine = process.env['SCAN_ENGINE'] ?? 'passthrough';

  switch (scanEngine) {
    case 'clamav': {
      const host = process.env['CLAMAV_HOST'] ?? 'localhost';
      const port = parseInt(process.env['CLAMAV_PORT'] ?? '3310', 10);
      const timeout = parseInt(process.env['CLAMAV_TIMEOUT'] ?? '30000', 10);

      console.log(`[ScanProvider] Using ClamAV at ${host}:${port}`);

      return new ClamAVScanProvider({
        host,
        port,
        timeout,
      });
    }

    case 'passthrough':
    default: {
      if (process.env['NODE_ENV'] === 'production') {
        console.warn(
          '[ScanProvider] WARNING: Passthrough scanner in production - files are NOT being scanned!'
        );
      }
      return new PassthroughScanProvider();
    }
  }
}

export { ClamAVScanProvider } from './ClamAVScanProvider';
export { PassthroughScanProvider } from './PassthroughScanProvider';
