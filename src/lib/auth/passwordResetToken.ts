import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import type { Prisma } from '@prisma/client';

const PUBLIC_PREFIX = 'prt1_';
const STORED_PREFIX = 'prh1:';
const TOKEN_BYTES = 32;
const TOKEN_BODY_LENGTH = 43;
const PURPOSE = 'vaultspace/password-reset-token/hmac/v1';

const NEW_PUBLIC_PATTERN = new RegExp(`^${PUBLIC_PREFIX}[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);
const STORED_PATTERN = new RegExp(`^${STORED_PREFIX}[a-f0-9]{64}$`);
const LEGACY_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);

export class PasswordResetTokenConfigurationError extends Error {
  readonly code: 'PASSWORD_RESET_TOKEN_SECRET_MISSING' | 'PASSWORD_RESET_TOKEN_WRITE_MODE_INVALID';

  constructor(
    code:
      | 'PASSWORD_RESET_TOKEN_SECRET_MISSING'
      | 'PASSWORD_RESET_TOKEN_WRITE_MODE_INVALID' = 'PASSWORD_RESET_TOKEN_SECRET_MISSING'
  ) {
    super('Password reset token configuration is unavailable');
    this.name = 'PasswordResetTokenConfigurationError';
    this.code = code;
  }
}

export interface PasswordResetTokenPair {
  publicToken: string;
  storedToken: string;
  format: 'hmac' | 'legacy';
}

export interface PasswordResetTokenLookup {
  storedToken: string;
  format: 'hmac' | 'legacy';
}

export type PasswordResetTokenWriteMode = 'legacy' | 'hmac';

/**
 * Serialize every account-global password-reset lifecycle edge without relying
 * on tenant-scoped row locks. This works for the NOBYPASSRLS worker role and is
 * paired with ordinary row locks in web transactions where org context exists.
 */
export async function lockPasswordResetUser(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  userId: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`vaultspace/password-reset/user/${userId}`}, 0)
    )`;
}

export function getPasswordResetTokenWriteMode(): PasswordResetTokenWriteMode {
  const value = process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];
  if (value === undefined || value === '' || value === 'legacy') {
    return 'legacy';
  }
  if (value === 'hmac') {
    return 'hmac';
  }
  throw new PasswordResetTokenConfigurationError('PASSWORD_RESET_TOKEN_WRITE_MODE_INVALID');
}

export function requirePasswordResetTokenSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret || secret.trim().length === 0) {
    throw new PasswordResetTokenConfigurationError();
  }
  getPasswordResetTokenWriteMode();
  return secret;
}

function resetTokenKey(secret: string): Buffer {
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
  return createHmac('sha256', resetTokenKey(secret))
    .update(`${PURPOSE}\0${publicToken}`, 'utf8')
    .digest('hex');
}

export function createPasswordResetToken(): PasswordResetTokenPair {
  const secret = requirePasswordResetTokenSecret();
  const tokenBody = randomBytes(TOKEN_BYTES).toString('base64url');

  // Rollout is expand, activate, contract. The first deployment is a dual
  // reader that continues writing legacy rows. HMAC writes are enabled only
  // after this image is the known-compatible rollback target.
  if (getPasswordResetTokenWriteMode() === 'legacy') {
    return { publicToken: tokenBody, storedToken: tokenBody, format: 'legacy' };
  }

  const publicToken = `${PUBLIC_PREFIX}${tokenBody}`;
  return {
    publicToken,
    storedToken: `${STORED_PREFIX}${digestPublicToken(publicToken, secret)}`,
    format: 'hmac',
  };
}

export function resolvePasswordResetTokenLookup(
  presentedToken: string
): PasswordResetTokenLookup | null {
  const secret = requirePasswordResetTokenSecret();

  if (NEW_PUBLIC_PATTERN.test(presentedToken)) {
    return {
      storedToken: `${STORED_PREFIX}${digestPublicToken(presentedToken, secret)}`,
      format: 'hmac',
    };
  }

  if (LEGACY_PATTERN.test(presentedToken)) {
    return { storedToken: presentedToken, format: 'legacy' };
  }

  return null;
}

export function passwordResetTokenMatchesStoredValue(
  presentedToken: string,
  storedToken: string
): boolean {
  const lookup = resolvePasswordResetTokenLookup(presentedToken);
  if (!lookup || lookup.storedToken.length !== storedToken.length) {
    return false;
  }

  const expected = Buffer.from(lookup.storedToken, 'utf8');
  const actual = Buffer.from(storedToken, 'utf8');
  return timingSafeEqual(expected, actual);
}

export function isStoredPasswordResetDigest(value: string): boolean {
  return STORED_PATTERN.test(value);
}
