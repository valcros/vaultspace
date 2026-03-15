/**
 * VaultSpace Constants
 *
 * Central location for all application constants.
 */

// Session configuration
export const SESSION_CONFIG = {
  COOKIE_NAME: 'vaultspace-session',
  IDLE_TIMEOUT_HOURS: 24,
  ABSOLUTE_MAX_DAYS: 7,
  TOKEN_LENGTH: 32, // 256 bits
} as const;

// Password configuration
export const PASSWORD_CONFIG = {
  BCRYPT_ROUNDS: 12,
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
} as const;

// Rate limiting
export const RATE_LIMIT_CONFIG = {
  VIEWER_REQUESTS_PER_MINUTE: 100,
  ADMIN_REQUESTS_PER_MINUTE: 1000,
  LOGIN_ATTEMPTS_PER_EMAIL_PER_MINUTE: 5,
  LOGIN_ATTEMPTS_PER_IP_PER_MINUTE: 20,
  UPLOAD_LIMIT_PER_USER_PER_MINUTE: 10,
} as const;

// File upload
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024, // 500 MB
  ALLOWED_MIME_TYPES: [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain',
    'text/csv',
    'text/rtf',
    'application/rtf',
    // Images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Archives
    'application/zip',
    'application/x-zip-compressed',
  ],
} as const;

// Signed URL expiry
export const SIGNED_URL_CONFIG = {
  PREVIEW_EXPIRY_SECONDS: 300, // 5 minutes
  DOWNLOAD_EXPIRY_SECONDS: 3600, // 1 hour
} as const;

// Job queue
export const JOB_QUEUE_CONFIG = {
  DEFAULT_CONCURRENCY: 5,
  PREVIEW_CONCURRENCY: 2,
  SCAN_CONCURRENCY: 5,
  GENERAL_CONCURRENCY: 10,
  DEFAULT_RETRY_ATTEMPTS: 3,
  DEFAULT_RETRY_DELAY_MS: 5000,
} as const;

// Supported file types for preview
export const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/rtf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Error codes
export const ERROR_CODES = {
  // Auth errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  UPLOAD_FAILED: 'UPLOAD_FAILED',

  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

// Tenant-scoped models (for middleware validation)
export const TENANT_SCOPED_MODELS = [
  'Room',
  'Folder',
  'Document',
  'DocumentVersion',
  'FileBlob',
  'PreviewAsset',
  'ExtractedText',
  'SearchIndex',
  'Link',
  'LinkVisit',
  'ViewSession',
  'Permission',
  'RoleAssignment',
  'Group',
  'GroupMembership',
  'Event',
  'RoomTemplate',
  'Notification',
  'NotificationPreference',
  'Invitation',
] as const;
