/**
 * Passthrough Scan Provider
 *
 * A demonstration scan provider that marks all files as clean.
 * Used when no virus scanning backend is configured.
 *
 * WARNING: This should ONLY be used for development/demonstration.
 * Production deployments MUST use a real scanner like ClamAV.
 */

import type { ScanProvider, ScanResult } from '../types';

export class PassthroughScanProvider implements ScanProvider {
  private warnOnce = true;

  async scan(_data: Buffer): Promise<ScanResult> {
    if (this.warnOnce) {
      console.warn(
        '[PassthroughScanProvider] WARNING: Using passthrough scanner - files are NOT being scanned for malware!'
      );
      this.warnOnce = false;
    }

    return {
      clean: true,
      scanDuration: 0,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
