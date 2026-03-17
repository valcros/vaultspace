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

    // Check file size
    if (data.length > this.maxSize) {
      return {
        clean: false,
        threats: [`File exceeds maximum scan size (${this.maxSize} bytes)`],
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
        const result = this.parseResponse(response.trim(), scanDuration);
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
        const response = data.toString().trim();
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
    // Response format: "stream: OK" or "stream: <virus_name> FOUND"
    if (response.includes('OK')) {
      return {
        clean: true,
        scanDuration,
      };
    }

    // Extract threat name(s)
    const threatMatch = response.match(/stream: (.+) FOUND/);
    const threatName = threatMatch?.[1];
    const threats: string[] = threatName ? [threatName] : ['Unknown threat detected'];

    return {
      clean: false,
      threats,
      scanDuration,
    };
  }
}
