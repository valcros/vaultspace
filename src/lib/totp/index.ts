/**
 * TOTP (Time-based One-Time Password) Implementation (F024)
 *
 * Implements RFC 6238 TOTP using Node.js built-in crypto module.
 * - HMAC-SHA1 based
 * - 30-second time step
 * - 6-digit codes
 * - +/-1 window for clock skew tolerance
 */

import {
  createHmac,
  randomBytes,
  createHash,
  timingSafeEqual as cryptoTimingSafeEqual,
} from 'crypto';

// Base32 alphabet (RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer to base32 string
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Decode a base32 string to Buffer
 */
export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_CHARS.indexOf(cleaned[i]!);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Generate a random TOTP secret (20 bytes, base32-encoded)
 */
export function generateTOTPSecret(): string {
  const secret = randomBytes(20);
  return base32Encode(secret);
}

/**
 * Generate HMAC-based OTP value for a given counter
 */
function generateHOTP(secret: string, counter: number): string {
  const secretBuffer = base32Decode(secret);

  // Convert counter to 8-byte big-endian buffer
  const counterBuffer = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  // HMAC-SHA1
  const hmac = createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1]! & 0x0f;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  // 6-digit code
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Generate current TOTP code
 */
export function generateTOTP(secret: string, timeStep = 30): string {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  return generateHOTP(secret, counter);
}

/**
 * Verify a TOTP code with +/-1 time window tolerance
 */
export function verifyTOTP(secret: string, code: string, timeStep = 30, window = 1): boolean {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return false;
  }

  const counter = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const expected = generateHOTP(secret, counter + i);
    if (timingSafeEqual(code, expected)) {
      return true;
    }
  }

  return false;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = new Uint8Array(Buffer.from(a));
  const bufB = new Uint8Array(Buffer.from(b));
  // Use crypto.timingSafeEqual for constant-time comparison
  return cryptoTimingSafeEqual(bufA, bufB);
}

/**
 * Build an otpauth:// URI for authenticator apps
 */
export function buildOTPAuthURI(secret: string, userEmail: string, issuer = 'VaultSpace'): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(userEmail);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generate random backup codes (8 alphanumeric codes of 8 characters)
 */
export function generateBackupCodes(count = 8, length = 8): string[] {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(length);
    let code = '';
    for (let j = 0; j < length; j++) {
      code += chars[bytes[j]! % chars.length];
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Hash a backup code with SHA-256
 */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase().trim()).digest('hex');
}

/**
 * Verify a backup code against a list of hashed codes.
 * Returns the index of the matching code, or -1 if not found.
 */
export function verifyBackupCode(code: string, hashedCodes: string[]): number {
  const hashed = hashBackupCode(code);
  return hashedCodes.findIndex((h) => h === hashed);
}
