import { createHash, randomBytes } from 'crypto';

const CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Creates an opaque browser challenge token. Only its SHA-256 digest is ever
 * persisted, so a database read cannot replay an in-progress MFA challenge.
 */
export function generateTwoFactorChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashTwoFactorChallengeToken(token: string): string | null {
  if (!CHALLENGE_TOKEN_PATTERN.test(token)) {
    return null;
  }
  return createHash('sha256').update(token).digest('hex');
}
