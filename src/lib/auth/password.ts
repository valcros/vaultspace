/**
 * Password Utilities
 *
 * Secure password hashing and validation using bcryptjs.
 * Using bcryptjs (pure JS) for cross-platform Docker compatibility.
 */

import bcrypt from 'bcryptjs';

import { PASSWORD_CONFIG } from '../constants';

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_CONFIG.BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < PASSWORD_CONFIG.MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_CONFIG.MIN_LENGTH} characters`);
  }

  if (password.length > PASSWORD_CONFIG.MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_CONFIG.MAX_LENGTH} characters`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
