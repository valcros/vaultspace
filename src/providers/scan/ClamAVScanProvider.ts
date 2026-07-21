/**
 * ClamAV Scan Provider
 *
 * Connects to a ClamAV daemon (clamd) over TCP for virus scanning.
 * Suitable for production deployments requiring real malware detection.
 */

import * as net from 'net';

import type { ScanProvider, ScanResult } from '../types';

export interface ClamAVConfig {
  host: string;
  port: number;
  timeout?: number; // Connection timeout in ms
  maxSize?: number; // Max file size in bytes (default: 25MB)
}

function normalizeClamdResponse(response: string): string {
  return response.replace(/\0/g, '').trim();
}

export class ClamAVScanProvider implements ScanProvider {
  private host: string;
  private port: number;
  private timeout: number;
  private maxSize: number;

  constructor(config: ClamAVConfig) {
    this.host = config.host;
    this.port = config.port;
    this.timeout = config.timeout ?? 30000;
    this.maxSize = config.maxSize ?? 25 * 1024 * 1024;
  }

  async scan(data: Buffer): Promise<ScanResult> {
    const startTime = Date.now();

    // Too large to scan: allow it through but flag as UNSCANNED. Marking an
    // oversize file as a threat false-positive-quarantines legitimate large
    // uploads (e.g. video). Raise the effective limit via CLAMAV_MAX_SCAN_BYTES
    // (and clamd's StreamMaxLength) to scan bigger files.
    if (data.length > this.maxSize) {
      return {
        clean: true,
        skipped: true,
        skipReason: `File exceeds the scanner's maximum scan size (${data.length} > ${this.maxSize} bytes); allowed but not virus-scanned`,
        scanDuration: Date.now() - startTime,
      };
    }

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let response = '';

      socket.setTimeout(this.timeout);

      socket.on('connect', () => {
        // Send INSTREAM command followed by file data in chunks
        // ClamAV expects: zINSTREAM\0 then length-prefixed chunks, ending with 0-length
        socket.write('zINSTREAM\0');

        // Send file in chunks (max 2KB per chunk for ClamAV)
        const chunkSize = 2048;
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
          const lengthBuffer = Buffer.alloc(4);
          lengthBuffer.writeUInt32BE(chunk.length, 0);
          socket.write(lengthBuffer);
          socket.write(chunk);
        }

        // Send zero-length chunk to signal end of stream
        const endBuffer = Buffer.alloc(4);
        endBuffer.writeUInt32BE(0, 0);
        socket.write(endBuffer);
      });

      socket.on('data', (chunk) => {
        response += chunk.toString();
      });

      socket.on('end', () => {
        const scanDuration = Date.now() - startTime;
        const result = this.parseResponse(normalizeClamdResponse(response), scanDuration);
        resolve(result);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`ClamAV scan timeout after ${this.timeout}ms`));
      });

      socket.on('error', (err) => {
        reject(new Error(`ClamAV connection error: ${err.message}`));
      });

      socket.connect(this.port, this.host);
    });
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(5000);

      socket.on('connect', () => {
        // Send PING command
        socket.write('zPING\0');
      });

      socket.on('data', (data) => {
        const response = normalizeClamdResponse(data.toString());
        socket.destroy();
        resolve(response === 'PONG');
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(this.port, this.host);
    });
  }

  private parseResponse(response: string, scanDuration: number): ScanResult {
    const normalized = response.trim();

    // A detected threat MUST take precedence and must never be misread as clean
    // (e.g. a substring "OK" inside a signature name). clamd's INSTREAM threat
    // response is exactly: "stream: <signature> FOUND".
    const threatMatch = normalized.match(/^stream:\s+(.+)\s+FOUND$/);
    if (threatMatch?.[1]) {
      return {
        clean: false,
        threats: [threatMatch[1]],
        scanDuration,
      };
    }

    // Clean is ONLY an exact "stream: OK".
    if (normalized === 'stream: OK') {
      return {
        clean: true,
        scanDuration,
      };
    }

    // clamd rejects streams over its StreamMaxLength with this exact error. That
    // is NOT a threat -- allow the file through, flagged as unscanned.
    if (/INSTREAM size limit exceeded/i.test(normalized)) {
      return {
        clean: true,
        skipped: true,
        skipReason: `Scanner could not scan the file (too large): ${normalized}; allowed but not virus-scanned`,
        scanDuration,
      };
    }

    // Anything else is an unexpected/malformed response. Fail as a scan error
    // (retryable) rather than guessing clean/skipped from a substring.
    throw new Error(`Unexpected ClamAV response: ${normalized}`);
  }
}
