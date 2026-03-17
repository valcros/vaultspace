/**
 * Azure Blob Storage Provider
 *
 * Stores files in Azure Blob Storage containers.
 * Suitable for production deployments on Azure.
 */

import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

import type { StorageProvider } from '../types';

export interface AzureBlobStorageConfig {
  accountName: string;
  accountKey: string;
  // Optional: use connection string instead
  connectionString?: string;
}

export class AzureBlobStorageProvider implements StorageProvider {
  private blobServiceClient: BlobServiceClient;
  private sharedKeyCredential: StorageSharedKeyCredential;
  private accountName: string;
  private containerClients: Map<string, ContainerClient> = new Map();

  constructor(config: AzureBlobStorageConfig) {
    this.accountName = config.accountName;

    if (config.connectionString) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
      // Extract account key from connection string for SAS generation
      const match = config.connectionString.match(/AccountKey=([^;]+)/);
      const accountKey = match?.[1] ?? config.accountKey;
      if (!accountKey) {
        throw new Error('Azure storage requires accountKey in config or connection string');
      }
      this.sharedKeyCredential = new StorageSharedKeyCredential(config.accountName, accountKey);
    } else if (config.accountKey) {
      this.sharedKeyCredential = new StorageSharedKeyCredential(
        config.accountName,
        config.accountKey
      );
      this.blobServiceClient = new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        this.sharedKeyCredential
      );
    } else {
      throw new Error('Azure storage requires either connectionString or accountKey');
    }
  }

  /**
   * Get or create a container client
   */
  private async getContainerClient(containerName: string): Promise<ContainerClient> {
    let client = this.containerClients.get(containerName);

    if (!client) {
      client = this.blobServiceClient.getContainerClient(containerName);

      // Ensure container exists
      const exists = await client.exists();
      if (!exists) {
        await client.create();
        console.log(`[AzureBlobStorage] Created container: ${containerName}`);
      }

      this.containerClients.set(containerName, client);
    }

    return client;
  }

  async put(bucket: string, key: string, data: Buffer): Promise<void> {
    const containerClient = await this.getContainerClient(bucket);
    const blobClient = containerClient.getBlockBlobClient(key);

    await blobClient.uploadData(data, {
      blobHTTPHeaders: {
        blobContentType: this.inferContentType(key),
      },
    });
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const containerClient = await this.getContainerClient(bucket);
    const blobClient = containerClient.getBlobClient(key);

    const downloadResponse = await blobClient.download(0);

    if (!downloadResponse.readableStreamBody) {
      throw new Error(`Failed to download blob: ${bucket}/${key}`);
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async delete(bucket: string, key: string): Promise<void> {
    const containerClient = await this.getContainerClient(bucket);
    const blobClient = containerClient.getBlobClient(key);

    await blobClient.deleteIfExists();
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    const containerClient = await this.getContainerClient(bucket);
    const blobClient = containerClient.getBlobClient(key);

    return blobClient.exists();
  }

  async getSignedUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string> {
    const containerClient = await this.getContainerClient(bucket);
    const blobClient = containerClient.getBlobClient(key);

    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiresInSeconds * 1000);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: bucket,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'), // Read only
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      this.sharedKeyCredential
    ).toString();

    return `${blobClient.url}?${sasToken}`;
  }

  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    const destContainerClient = await this.getContainerClient(destBucket);
    const destBlobClient = destContainerClient.getBlockBlobClient(destKey);

    // Generate a SAS URL for the source blob for the copy operation
    const sourceUrl = await this.getSignedUrl(sourceBucket, sourceKey, 3600);

    // Start the copy operation
    const copyPoller = await destBlobClient.beginCopyFromURL(sourceUrl);
    await copyPoller.pollUntilDone();
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
