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
  /** Per-org sender override (see EmailOptions). Falls back to the global sender. */
  from?: string;
  fromName?: string;
  /** Password-reset-specific correlation and durable delivery context. */
  passwordReset?: {
    flowId: string;
    userId: string;
    requestId: string;
    organizationIds: string[];
  };
}

/** Flow-only payload. The reset bearer token and recipient stay in PostgreSQL. */
export interface PasswordResetDeliveryJobPayload {
  schemaVersion: 1;
  flowId: string;
  deliveryAttempt: number;
}

/** Sensitive provider acceptance bookkeeping recovery. Contains no bearer token. */
export interface PasswordResetAcceptanceJobPayload {
  schemaVersion: 1;
  flowId: string;
  provider: string;
  providerMessageId: string;
  providerAcceptedAt: string;
  sendFence: number;
  requestId: string | null;
}

export interface NotificationJobPayload {
  organizationId: string;
  roomId: string;
  documentId: string;
  uploaderId?: string;
  viewerId?: string;
  viewerEmail?: string;
  /**
   * When true (set by the admin preview route), the notify-document-viewed
   * processor increments document.viewCount. Link-based view jobs do not set
   * this flag, preserving their existing semantics (they only count on the
   * Link record).
   */
  incrementViewCount?: boolean;
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
  PASSWORD_RESET_DELIVER: 'password-reset.deliver',
  PASSWORD_RESET_ACCEPTANCE_RECONCILE: 'password-reset.acceptance-reconcile',
  NOTIFY_DOCUMENT_UPLOADED: 'notify-document-uploaded',
  NOTIFY_DOCUMENT_VIEWED: 'notify-document-viewed',

  // Export
  EXPORT_ZIP: 'export.zip',
  ROOM_EXPORT: 'room.export',

  // Cleanup
  CLEANUP_EXPIRED: 'cleanup.expired',
  CLEANUP_TRASH: 'cleanup.trash',
} as const;

// Scan jobs may cold-start the worker and ClamAV sidecar together in Azure.
// Give clamd time to become ready without requiring a warm worker replica.
export const DOCUMENT_SCAN_JOB_OPTIONS = {
  attempts: 10,
  backoff: {
    type: 'exponential',
    delay: 10000,
  },
} as const;

// Email retry policy from JOB_SPECS.md. Callers opt in explicitly so unrelated
// processors are not made retryable without an idempotency review.
export const PASSWORD_RESET_EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 60_000,
  },
  // Reset URLs are bearer credentials. Remove successful payloads immediately
  // and remove terminal failures immediately after retries are exhausted.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

// Durable retry decisions for HMAC reset flows are made from PostgreSQL. A
// BullMQ retry cannot distinguish definitive rejection from unknown acceptance.
export const PASSWORD_RESET_RECOVERY_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const;

// Acceptance reconciliation is bounded sensitive correlation data and is
// idempotent. Retrying it cannot resubmit email, so it can use ordinary BullMQ
// retries in addition to DB retry.
export const PASSWORD_RESET_ACCEPTANCE_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  // Retain exhausted acceptance facts for bounded incident response. This
  // payload is sensitive correlation data but contains no bearer token.
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
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
