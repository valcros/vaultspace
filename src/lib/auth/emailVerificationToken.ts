/**
 * Email Verification Token (HMAC digest at rest)
 *
 * Mirrors the password-reset token pattern (see passwordResetToken.ts): the
 * plaintext token is sent to the user; only a keyed HMAC digest is stored, so a
 * database/backup read cannot mint a valid verification link. This flow is
 * greenfield (no pre-existing tokens), so there is no legacy dual-read mode.
 */

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';

const PUBLIC_PREFIX = 'evt1_';
const STORED_PREFIX = 'evh1:';
const TOKEN_BYTES = 32;
const TOKEN_BODY_LENGTH = 43;
const PURPOSE = 'vaultspace/email-verification-token/hmac/v1';

const PUBLIC_PATTERN = new RegExp(`^${PUBLIC_PREFIX}[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);
const STORED_PATTERN = new RegExp(`^${STORED_PREFIX}[a-f0-9]{64}$`);

export class EmailVerificationTokenConfigurationError extends Error {
  readonly code = 'EMAIL_VERIFICATION_TOKEN_SECRET_MISSING';

  constructor() {
    super('Email verification token configuration is unavailable');
    this.name = 'EmailVerificationTokenConfigurationError';
  }
}

export interface EmailVerificationTokenPair {
  /** Sent to the user (in the verification link); never persisted. */
  publicToken: string;
  /** Persisted in email_verification_tokens.token; a keyed digest. */
  storedToken: string;
}

function requireSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret || secret.trim().length === 0) {
    throw new EmailVerificationTokenConfigurationError();
  }
  return secret;
}

function verificationKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('vaultspace', 'utf8'),
      Buffer.from(PURPOSE, 'utf8'),
      32
    )
  );
}

function digestPublicToken(publicToken: string, secret: string): string {
  return createHmac('sha256', verificationKey(secret))
    .update(`${PURPOSE}\0${publicToken}`, 'utf8')
    .digest('hex');
}

/** Mint a new (publicToken, storedToken) pair. */
export function createEmailVerificationToken(): EmailVerificationTokenPair {
  const secret = requireSecret();
  const publicToken = `${PUBLIC_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return {
    publicToken,
    storedToken: `${STORED_PREFIX}${digestPublicToken(publicToken, secret)}`,
  };
}

/**
 * Resolve a presented (plaintext) token to the stored digest to look up, or
 * null if the token is malformed (fail-closed — never look up on bad syntax).
 */
export function resolveStoredToken(presentedToken: string): string | null {
  if (!PUBLIC_PATTERN.test(presentedToken)) {
    return null;
  }
  const secret = requireSecret();
  return `${STORED_PREFIX}${digestPublicToken(presentedToken, secret)}`;
}

/** Constant-time compare of a presented token against a stored digest. */
export function emailVerificationTokenMatches(
  presentedToken: string,
  storedToken: string
): boolean {
  const resolved = resolveStoredToken(presentedToken);
  if (!resolved || resolved.length !== storedToken.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(resolved, 'utf8'), Buffer.from(storedToken, 'utf8'));
}

export function isStoredEmailVerificationDigest(value: string): boolean {
  return STORED_PATTERN.test(value);
}
