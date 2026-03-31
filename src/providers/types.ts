/**
 * Provider Interface Types
 *
 * All external integrations go through typed provider interfaces.
 * This enables swappable implementations without changing business logic.
 */

// =============================================================================
// Storage Provider
// =============================================================================

export interface StorageProvider {
  /**
   * Upload a file to storage
   */
  put(bucket: string, key: string, data: Buffer): Promise<void>;

  /**
   * Download a file from storage
   */
  get(bucket: string, key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   */
  delete(bucket: string, key: string): Promise<void>;

  /**
   * Check if a file exists
   */
  exists(bucket: string, key: string): Promise<boolean>;

  /**
   * Get a signed URL for temporary access
   */
  getSignedUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Copy a file within storage
   */
  copy(sourceBucket: string, sourceKey: string, destBucket: string, destKey: string): Promise<void>;
}

// =============================================================================
// Email Provider
// =============================================================================

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailProvider {
  /**
   * Send an email
   */
  sendEmail(options: EmailOptions): Promise<{ messageId: string }>;
}

// =============================================================================
// Cache Provider
// =============================================================================

export interface CacheProvider {
  /**
   * Get a value from cache
   */
  get<T = string>(key: string): Promise<T | null>;

  /**
   * Set a value in cache with optional TTL (seconds)
   */
  set<T = string>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a value from cache
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Increment a numeric value (for rate limiting)
   */
  increment(key: string, ttlSeconds?: number): Promise<number>;

  /**
   * Set with expiry only if not exists (for distributed locks)
   */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

// =============================================================================
// Job Provider
// =============================================================================

export type JobPriority = 'high' | 'normal' | 'low';

export interface JobOptions {
  priority?: JobPriority;
  delay?: number; // milliseconds
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
}

export interface JobResult<T = unknown> {
  jobId: string;
  data: T;
  status: 'completed' | 'failed';
  error?: string;
}

export interface JobProvider {
  /**
   * Add a job to the queue
   */
  addJob<T>(queueName: string, jobName: string, data: T, options?: JobOptions): Promise<string>;

  /**
   * Get job status
   */
  getJobStatus(queueName: string, jobId: string): Promise<string>;

  /**
   * Cancel a pending job
   */
  cancelJob(queueName: string, jobId: string): Promise<void>;
}

// =============================================================================
// Scan Provider (Virus Scanning)
// =============================================================================

export interface ScanResult {
  clean: boolean;
  threats?: string[];
  scanDuration?: number;
}

export interface ScanProvider {
  /**
   * Scan a file for malware
   */
  scan(data: Buffer): Promise<ScanResult>;

  /**
   * Check if scanner is available
   */
  isAvailable(): Promise<boolean>;
}

// =============================================================================
// Preview Provider (Document Conversion)
// =============================================================================

export interface PreviewOptions {
  format?: 'pdf' | 'png' | 'jpeg';
  quality?: number;
  dpi?: number;
  maxPages?: number;
}

export interface PreviewResult {
  pages: PreviewPage[];
  totalPages: number;
  mimeType: string;
}

export interface PreviewPage {
  pageNumber: number;
  data: Buffer;
  width: number;
  height: number;
  mimeType: string;
}

export interface PreviewProvider {
  /**
   * Convert a document to preview format
   */
  convert(data: Buffer, mimeType: string, options?: PreviewOptions): Promise<PreviewResult>;

  /**
   * Generate a thumbnail (legacy — resizes an already-rendered image)
   */
  generateThumbnail(data: Buffer, mimeType: string, width: number, height: number): Promise<Buffer>;

  /**
   * Generate a PNG thumbnail directly from original file bytes.
   * Always returns a PNG buffer. Never throws — catches internally and
   * falls back to branded placeholder, then to Sharp SVG placeholder.
   */
  generateThumbnailPng(
    data: Buffer,
    mimeType: string,
    fileName: string,
    width: number,
    height: number
  ): Promise<Buffer>;

  /**
   * Check if a mime type is supported
   */
  isSupported(mimeType: string): boolean;
}

// =============================================================================
// Search Provider
// =============================================================================

export interface SearchQuery {
  query: string;
  organizationId: string;
  roomId?: string;
  filters?: {
    mimeTypes?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    tags?: string[];
  };
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  documentId: string;
  versionId: string;
  title: string;
  snippet: string;
  score: number;
  highlights?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  took: number; // milliseconds
}

export interface SearchProvider {
  /**
   * Search documents
   */
  search(query: SearchQuery): Promise<SearchResponse>;

  /**
   * Index a document
   */
  index(
    organizationId: string,
    documentId: string,
    versionId: string,
    content: {
      title: string;
      text: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void>;

  /**
   * Remove a document from index
   */
  remove(organizationId: string, documentId: string): Promise<void>;
}

// =============================================================================
// Encryption Provider
// =============================================================================

export interface EncryptionResult {
  ciphertext: Buffer;
  iv: Buffer;
  tag?: Buffer;
  algorithm: string;
}

export interface EncryptionProvider {
  /**
   * Encrypt data
   */
  encrypt(plaintext: Buffer, keyId?: string): Promise<EncryptionResult>;

  /**
   * Decrypt data
   */
  decrypt(encrypted: EncryptionResult, keyId?: string): Promise<Buffer>;

  /**
   * Generate a new encryption key
   */
  generateKey(): Promise<{ keyId: string; key: Buffer }>;
}

// =============================================================================
// OCR Provider (F132)
// =============================================================================

export interface OCROptions {
  language?: string; // ISO language code, default 'eng'
  quality?: 'fast' | 'normal' | 'high';
}

export interface OCRResult {
  text: string;
  confidence: number;
  language: string;
}

export interface OCRProvider {
  /**
   * Extract text from an image or scanned document
   */
  extractText(data: Buffer, mimeType: string, options?: OCROptions): Promise<OCRResult>;

  /**
   * Check if a document needs OCR (scanned/image-based)
   */
  requiresOCR(data: Buffer, mimeType: string): Promise<boolean>;

  /**
   * Check if OCR engine is available
   */
  isAvailable(): Promise<boolean>;
}

// =============================================================================
// Provider Factory
// =============================================================================

export interface Providers {
  storage: StorageProvider;
  email: EmailProvider;
  cache: CacheProvider;
  job: JobProvider;
  scan: ScanProvider;
  preview: PreviewProvider;
  search: SearchProvider;
  encryption: EncryptionProvider;
  ocr: OCRProvider;
}
