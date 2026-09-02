/**
 * Durable email-verification delivery contract.
 *
 * Verification URLs create an organization administrator session, so their
 * bearer tokens must never be placed in Redis jobs, normal logs, or audits.
 * This module stores the public token only as authenticated encrypted recovery
 * material; workers receive a flow ID and decrypt immediately before sending.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const EMAIL_VERIFICATION_DELIVERY_CONTRACT_VERSION = 1 as const;

const PURPOSE = 'vaultspace/email-verification-delivery/v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PUBLIC_TOKEN_PATTERN = /^evt1_[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type EmailVerificationDeliveryMode = 'legacy' | 'durable';

export class EmailVerificationDeliveryContractError extends Error {
  constructor(
    readonly code:
      | 'EMAIL_VERIFICATION_RECOVERY_KEYS_MISSING'
      | 'EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID'
      | 'EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_MISSING'
      | 'EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_INVALID'
      | 'EMAIL_VERIFICATION_RECOVERY_KEY_UNAVAILABLE'
      | 'EMAIL_VERIFICATION_RECOVERY_ENVELOPE_INVALID'
      | 'EMAIL_VERIFICATION_RECOVERY_TOKEN_MISMATCH'
  ) {
    super('Email verification delivery recovery configuration or envelope is invalid');
    this.name = 'EmailVerificationDeliveryContractError';
  }
}

interface KeyRing {
  activeKeyId: string | null;
  keys: Map<string, Buffer>;
}

export interface EmailVerificationRecoveryEnvelope {
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  recipientFingerprint: string;
}

export interface EmailVerificationRecoveryContext {
  flowId: string;
  storedToken: string;
  expiresAt: Date;
}

export function getEmailVerificationDeliveryMode(): EmailVerificationDeliveryMode {
  const configured = process.env['EMAIL_VERIFICATION_DELIVERY_MODE']?.trim().toLowerCase();
  if (!configured || configured === 'legacy') {
    return 'legacy';
  }
  if (configured === 'durable') {
    return 'durable';
  }
  throw new Error('EMAIL_VERIFICATION_DELIVERY_MODE must be legacy or durable');
}

function parseKeyRing(requireActiveKey = true): KeyRing {
  const raw = process.env['EMAIL_VERIFICATION_RECOVERY_KEYS'];
  if (!raw?.trim()) {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_MISSING');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 8) {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID');
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof encoded !== 'string') {
      throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
      throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEYS_INVALID');
    }
    keys.set(keyId, key);
  }
  const activeKeyId = process.env['EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_ID']?.trim();
  if (!activeKeyId) {
    if (requireActiveKey) {
      throw new EmailVerificationDeliveryContractError(
        'EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_MISSING'
      );
    }
    return { activeKeyId: null, keys };
  }
  if (!KEY_ID_PATTERN.test(activeKeyId) || !keys.has(activeKeyId)) {
    if (requireActiveKey) {
      throw new EmailVerificationDeliveryContractError(
        'EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_INVALID'
      );
    }
    return { activeKeyId: null, keys };
  }
  return { activeKeyId, keys };
}

function recipientFingerprint(email: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`${PURPOSE}\0recipient\0${email.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
}

function aad(
  context: EmailVerificationRecoveryContext,
  keyId: string,
  fingerprint: string
): Buffer {
  return Buffer.from(
    [
      PURPOSE,
      '1',
      keyId,
      context.flowId,
      context.storedToken,
      context.expiresAt.toISOString(),
      fingerprint,
    ].join('\0'),
    'utf8'
  );
}

export function validateEmailVerificationDeliveryConfiguration(): { activeKeyId: string } {
  const ring = parseKeyRing();
  return { activeKeyId: ring.activeKeyId! };
}

/**
 * Fail startup rather than accepting registrations into an enabled durable
 * path that cannot construct a safe HTTPS verification URL.
 */
export function validateEmailVerificationDeliveryUrlConfiguration(): void {
  const appUrl = process.env['APP_URL']?.trim();
  if (!appUrl) {
    throw new Error('EMAIL_VERIFICATION_APP_URL_MISSING');
  }
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error('EMAIL_VERIFICATION_APP_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' && process.env['NODE_ENV'] === 'production') {
    throw new Error('EMAIL_VERIFICATION_APP_URL_HTTPS_REQUIRED');
  }
}

export function encryptEmailVerificationRecoveryToken(
  publicToken: string,
  recipientEmail: string,
  context: EmailVerificationRecoveryContext
): EmailVerificationRecoveryEnvelope {
  if (!PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    throw new EmailVerificationDeliveryContractError(
      'EMAIL_VERIFICATION_RECOVERY_ENVELOPE_INVALID'
    );
  }
  const ring = parseKeyRing();
  const keyId = ring.activeKeyId!;
  const key = ring.keys.get(keyId)!;
  const fingerprint = recipientFingerprint(recipientEmail, key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context, keyId, fingerprint));
  const ciphertext = Buffer.concat([cipher.update(publicToken, 'utf8'), cipher.final()]);
  return {
    keyId,
    nonce,
    ciphertext,
    authTag: cipher.getAuthTag(),
    recipientFingerprint: fingerprint,
  };
}

export function decryptEmailVerificationRecoveryToken(
  envelope: Pick<
    EmailVerificationRecoveryEnvelope,
    'keyId' | 'nonce' | 'ciphertext' | 'authTag'
  > & {
    recipientFingerprint: string;
  },
  recipientEmail: string,
  context: EmailVerificationRecoveryContext
): string {
  const ring = parseKeyRing(false);
  const key = ring.keys.get(envelope.keyId);
  if (!key) {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_KEY_UNAVAILABLE');
  }
  if (
    envelope.nonce.length !== NONCE_BYTES ||
    envelope.authTag.length !== TAG_BYTES ||
    envelope.ciphertext.length < 48 ||
    envelope.ciphertext.length > 128
  ) {
    throw new EmailVerificationDeliveryContractError(
      'EMAIL_VERIFICATION_RECOVERY_ENVELOPE_INVALID'
    );
  }
  const expected = Buffer.from(envelope.recipientFingerprint, 'utf8');
  const actual = Buffer.from(recipientFingerprint(recipientEmail, key), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new EmailVerificationDeliveryContractError('EMAIL_VERIFICATION_RECOVERY_TOKEN_MISMATCH');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad(context, envelope.keyId, envelope.recipientFingerprint));
    decipher.setAuthTag(envelope.authTag);
    const token = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString(
      'utf8'
    );
    if (!PUBLIC_TOKEN_PATTERN.test(token)) {
      throw new EmailVerificationDeliveryContractError(
        'EMAIL_VERIFICATION_RECOVERY_TOKEN_MISMATCH'
      );
    }
    return token;
  } catch (error) {
    if (error instanceof EmailVerificationDeliveryContractError) {
      throw error;
    }
    throw new EmailVerificationDeliveryContractError(
      'EMAIL_VERIFICATION_RECOVERY_ENVELOPE_INVALID'
    );
  }
}
