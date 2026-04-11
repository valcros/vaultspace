/**
 * VaultSpace Error Classes
 *
 * Standardized error handling across the application.
 */

import { ERROR_CODES, HTTP_STATUS } from './constants';

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorDetails {
  field?: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Base error class for all VaultSpace errors
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ErrorDetails[];
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.INTERNAL_ERROR,
    statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    details?: ErrorDetails[],
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetails[]) {
    super(message, ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST, details);
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    super(message, code, HTTP_STATUS.UNAUTHORIZED);
  }
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return (
    error instanceof AuthenticationError ||
    (error instanceof Error && error.message === 'Authentication required')
  );
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, ERROR_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
  }
}

/**
 * Not found error (404)
 * Used for both missing resources and cross-tenant access attempts
 * to prevent existence disclosure.
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, ERROR_CODES.CONFLICT, HTTP_STATUS.CONFLICT);
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number) {
    super('Too many requests', ERROR_CODES.RATE_LIMITED, HTTP_STATUS.TOO_MANY_REQUESTS);
    this.retryAfter = retryAfter;
  }
}

/**
 * File upload error (400/422)
 */
export class UploadError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.UPLOAD_FAILED) {
    super(message, code, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * Check if an error is operational (expected) vs programming error
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return error.toJSON();
  }

  // Unknown error - don't leak details
  return {
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    },
  };
}
