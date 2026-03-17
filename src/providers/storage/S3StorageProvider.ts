/**
 * S3-Compatible Storage Provider (F065)
 *
 * Stores files in AWS S3 or S3-compatible storage (MinIO, DigitalOcean Spaces, etc.).
 * Suitable for production deployments on AWS or with S3-compatible object storage.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { StorageProvider } from '../types';

export interface S3StorageConfig {
  // AWS region (e.g., 'us-east-1')
  region: string;

  // AWS credentials (optional - can use IAM role or environment variables)
  accessKeyId?: string;
  secretAccessKey?: string;

  // S3-compatible endpoint for non-AWS services (MinIO, Spaces, etc.)
  endpoint?: string;

  // Force path-style URLs (required for MinIO and some S3-compatible services)
  forcePathStyle?: boolean;

  // Single bucket mode: Use one S3 bucket with logical buckets as key prefixes
  // e.g., bucket='vaultspace' -> keys like 'documents/org-123/file.pdf'
  bucket?: string;

  // Multi-bucket mode (legacy): Create separate buckets for each logical bucket
  // e.g., bucketPrefix='vaultspace' -> buckets like 'vaultspace-documents'
  // Only used if 'bucket' is not set
  bucketPrefix?: string;
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private singleBucket: string | null;
  private bucketPrefix: string;

  constructor(config: S3StorageConfig) {
    // Single bucket mode takes precedence (documented contract)
    this.singleBucket = config.bucket ?? null;
    // Legacy multi-bucket mode as fallback
    this.bucketPrefix = config.bucketPrefix ?? '';

    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: config.region,
    };

    // Add custom endpoint for S3-compatible services
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle ?? true;
    }

    // Add credentials if provided (otherwise uses default credential chain)
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Get the S3 bucket name based on mode:
   * - Single bucket mode: always returns the configured bucket
   * - Multi-bucket mode: returns prefix-{logicalBucket}
   */
  private getBucketName(logicalBucket: string): string {
    if (this.singleBucket) {
      return this.singleBucket;
    }
    return this.bucketPrefix ? `${this.bucketPrefix}-${logicalBucket}` : logicalBucket;
  }

  /**
   * Get the full S3 key path:
   * - Single bucket mode: logicalBucket/key (uses bucket as prefix)
   * - Multi-bucket mode: key (no prefix needed)
   */
  private getKeyPath(logicalBucket: string, key: string): string {
    if (this.singleBucket) {
      return `${logicalBucket}/${key}`;
    }
    return key;
  }

  async put(bucket: string, key: string, data: Buffer): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.getBucketName(bucket),
      Key: this.getKeyPath(bucket, key),
      Body: data,
      ContentType: this.inferContentType(key),
    });

    await this.client.send(command);
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.getBucketName(bucket),
      Key: this.getKeyPath(bucket, key),
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Failed to download object: ${bucket}/${key}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async delete(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.getBucketName(bucket),
      Key: this.getKeyPath(bucket, key),
    });

    await this.client.send(command);
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: this.getKeyPath(bucket, key),
      });

      await this.client.send(command);
      return true;
    } catch (error: unknown) {
      // S3 returns 404 NotFound for missing objects
      if (error && typeof error === 'object' && 'name' in error) {
        const s3Error = error as { name: string };
        if (s3Error.name === 'NotFound' || s3Error.name === 'NoSuchKey') {
          return false;
        }
      }
      throw error;
    }
  }

  async getSignedUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.getBucketName(bucket),
      Key: this.getKeyPath(bucket, key),
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.getBucketName(destBucket),
      Key: this.getKeyPath(destBucket, destKey),
      CopySource: `${this.getBucketName(sourceBucket)}/${this.getKeyPath(sourceBucket, sourceKey)}`,
    });

    await this.client.send(command);
  }

  /**
   * Infer content type from file extension
   */
  private inferContentType(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase();

    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'application/xml',
      zip: 'application/zip',
    };

    return contentTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}
