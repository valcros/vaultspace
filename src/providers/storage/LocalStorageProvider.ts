/**
 * Local Filesystem Storage Provider
 *
 * Stores files on the local filesystem.
 * Suitable for development and single-server deployments.
 */

import { createHash, randomBytes } from 'crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { SIGNED_URL_CONFIG } from '@/lib/constants';

import type { StorageProvider } from '../types';

export interface LocalStorageConfig {
  basePath: string;
  signedUrlSecret: string;
}

export class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private signedUrlSecret: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    this.signedUrlSecret = config.signedUrlSecret;
  }

  private getPath(bucket: string, key: string): string {
    return join(this.basePath, bucket, key);
  }

  async put(bucket: string, key: string, data: Buffer): Promise<void> {
    const filePath = this.getPath(bucket, key);
    const dir = dirname(filePath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename (atomic write)
    const tempPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;

    try {
      await writeFile(tempPath, data);
      await rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const filePath = this.getPath(bucket, key);
    return readFile(filePath);
  }

  async delete(bucket: string, key: string): Promise<void> {
    const filePath = this.getPath(bucket, key);
    await rm(filePath, { force: true });
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    const filePath = this.getPath(bucket, key);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number = SIGNED_URL_CONFIG.PREVIEW_EXPIRY_SECONDS
  ): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = `${bucket}:${key}:${expiresAt}`;
    const signature = this.sign(payload);

    // Return a URL that can be validated by the application
    const params = new URLSearchParams({
      bucket,
      key,
      expires: expiresAt.toString(),
      sig: signature,
    });

    return `/api/storage/download?${params.toString()}`;
  }

  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    const data = await this.get(sourceBucket, sourceKey);
    await this.put(destBucket, destKey, data);
  }

  /**
   * Validate a signed URL
   */
  validateSignedUrl(bucket: string, key: string, expires: string, signature: string): boolean {
    const expiresAt = parseInt(expires, 10);
    const now = Math.floor(Date.now() / 1000);

    // Check if expired
    if (now > expiresAt) {
      return false;
    }

    // Validate signature
    const payload = `${bucket}:${key}:${expiresAt}`;
    const expectedSignature = this.sign(payload);

    return signature === expectedSignature;
  }

  private sign(payload: string): string {
    return createHash('sha256')
      .update(`${payload}:${this.signedUrlSecret}`)
      .digest('hex')
      .slice(0, 32);
  }
}
