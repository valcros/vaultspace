/**
 * Token Generation Utilities
 *
 * Cryptographically secure random token generation.
 */

import { randomBytes } from 'crypto';

import { SESSION_CONFIG } from '../constants';

/**
 * Generate a secure random token
 */
export function generateToken(length: number = SESSION_CONFIG.TOKEN_LENGTH): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Generate a session token
 */
export function generateSessionToken(): string {
  return generateToken(SESSION_CONFIG.TOKEN_LENGTH);
}

/**
 * Generate an invitation token
 */
export function generateInvitationToken(): string {
  return generateToken(32);
}

/**
 * Generate a password reset token
 */
export function generatePasswordResetToken(): string {
  return generateToken(32);
}

/**
 * Generate an email verification token
 */
export function generateEmailVerificationToken(): string {
  return generateToken(32);
}
