/**
 * Worker Job Types
 *
 * Type definitions for background job payloads.
 */

// =============================================================================
// Document Processing Jobs
// =============================================================================

export interface ScanJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
}

export interface PreviewGenerateJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  isScanned: boolean;
}

export interface TextExtractJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  contentType: string;
  fileName: string;
  pageCount?: number;
  language?: string;
}

export interface ThumbnailGenerateJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  previewKey: string;
  pageNumber: number;
  width: number;
  height: number;
}

// =============================================================================
// Search & Analytics Jobs
// =============================================================================

export interface SearchIndexJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  roomId: string;
  fileName: string;
  text: string;
  metadata?: {
    author?: string;
    uploadedAt?: string;
    pageCount?: number;
  };
}

// =============================================================================
// Email Jobs
// =============================================================================

export interface EmailSendJobPayload {
  to: string | string[];
  subject: string;
  template: string;
  data: Record<string, unknown>;
  organizationId?: string;
}

// =============================================================================
// Export Jobs
// =============================================================================

export interface ExportZipJobPayload {
  exportId: string;
  organizationId: string;
  roomId: string;
  documentIds: string[];
  requestedBy: string;
  includeVersionHistory: boolean;
}

// =============================================================================
// Cleanup Jobs
// =============================================================================

export interface CleanupExpiredJobPayload {
  organizationId?: string;
  type: 'sessions' | 'links' | 'all';
}

export interface CleanupTrashJobPayload {
  organizationId?: string;
  retentionDays: number;
}

// =============================================================================
// Job Names
// =============================================================================

export const JOB_NAMES = {
  // Document processing
  DOCUMENT_SCAN: 'document.scan',
  PREVIEW_GENERATE: 'preview.generate',
  TEXT_EXTRACT: 'text.extract',
  THUMBNAIL_GENERATE: 'thumbnail.generate',

  // Search
  SEARCH_INDEX: 'search.index',

  // Email
  EMAIL_SEND: 'email.send',

  // Export
  EXPORT_ZIP: 'export.zip',

  // Cleanup
  CLEANUP_EXPIRED: 'cleanup.expired',
  CLEANUP_TRASH: 'cleanup.trash',
} as const;

// =============================================================================
// Queue Names
// =============================================================================

export const QUEUE_NAMES = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
  SCHEDULED: 'scheduled',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
