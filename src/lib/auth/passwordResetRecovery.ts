import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { passwordResetTokenMatchesStoredValue } from './passwordResetToken';

const PURPOSE_V1 = 'vaultspace/password-reset-recovery/v1';
const PURPOSE_V2 = 'vaultspace/password-reset-recovery/v2';
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PUBLIC_TOKEN_PATTERN = /^prt1_[A-Za-z0-9_-]{43}$/;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type PasswordResetRecoveryErrorCode =
  | 'PASSWORD_RESET_RECOVERY_KEYS_MISSING'
  | 'PASSWORD_RESET_RECOVERY_KEYS_INVALID'
  | 'PASSWORD_RESET_RECOVERY_ACTIVE_KEY_MISSING'
  | 'PASSWORD_RESET_RECOVERY_ACTIVE_KEY_INVALID'
  | 'PASSWORD_RESET_RECOVERY_KEY_UNAVAILABLE'
  | 'PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID'
  | 'PASSWORD_RESET_RECOVERY_TOKEN_MISMATCH';

export class PasswordResetRecoveryError extends Error {
  constructor(readonly code: PasswordResetRecoveryErrorCode) {
    super('Password reset recovery configuration or envelope is invalid');
    this.name = 'PasswordResetRecoveryError';
  }
}

export interface PasswordResetRecoveryContext {
  flowId: string;
  userId: string;
  storedToken: string;
  expiresAt: Date;
}

export interface PasswordResetRecoveryContextV2 {
  flowId: string;
  storedToken: string;
  providerOperationId: string;
}

export interface PasswordResetRecoveryEnvelope {
  cipherVersion: 1 | 2;
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  recipientFingerprint: string;
}

interface RecoveryKeyRing {
  activeKeyId: string | null;
  keys: Map<string, Buffer>;
}

function parseKeyRing(requireActiveKey = true): RecoveryKeyRing {
  const rawKeys = process.env['PASSWORD_RESET_RECOVERY_KEYS'];
  if (!rawKeys?.trim()) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_MISSING');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_INVALID');
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 8) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_INVALID');
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof encoded !== 'string') {
      throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_INVALID');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
      throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEYS_INVALID');
    }
    keys.set(keyId, key);
  }

  const activeKeyId = process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'];
  if (!activeKeyId?.trim()) {
    if (requireActiveKey) {
      throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ACTIVE_KEY_MISSING');
    }
    return { activeKeyId: null, keys };
  }
  if (!KEY_ID_PATTERN.test(activeKeyId) || !keys.has(activeKeyId)) {
    if (requireActiveKey) {
      throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ACTIVE_KEY_INVALID');
    }
    return { activeKeyId: null, keys };
  }
  return { activeKeyId, keys };
}

function aadV1(context: PasswordResetRecoveryContext, keyId: string): Buffer {
  return Buffer.from(
    [
      PURPOSE_V1,
      '1',
      keyId,
      context.flowId,
      context.userId,
      context.storedToken,
      context.expiresAt.toISOString(),
    ].join('\0'),
    'utf8'
  );
}

function aadV2(
  context: PasswordResetRecoveryContextV2,
  keyId: string,
  recipientFingerprint: string
): Buffer {
  return Buffer.from(
    [
      PURPOSE_V2,
      '2',
      keyId,
      context.flowId,
      context.storedToken,
      context.providerOperationId,
      recipientFingerprint,
    ].join('\0'),
    'utf8'
  );
}

function fingerprint(email: string, key: Buffer, cipherVersion: 1 | 2): string {
  const purpose = cipherVersion === 1 ? PURPOSE_V1 : PURPOSE_V2;
  return createHmac('sha256', key)
    .update(`${purpose}\0recipient\0${email.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
}

export function validatePasswordResetRecoveryConfiguration(): {
  activeKeyId: string;
  keyCount: number;
} {
  const ring = parseKeyRing();
  return { activeKeyId: ring.activeKeyId!, keyCount: ring.keys.size };
}

export function encryptPasswordResetRecoveryToken(
  publicToken: string,
  recipientEmail: string,
  context: PasswordResetRecoveryContext
): PasswordResetRecoveryEnvelope {
  if (!PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
  }
  const ring = parseKeyRing();
  const activeKeyId = ring.activeKeyId!;
  const key = ring.keys.get(activeKeyId)!;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadV1(context, activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(publicToken, 'utf8'), cipher.final()]);

  return {
    cipherVersion: 1,
    keyId: activeKeyId,
    nonce,
    ciphertext,
    authTag: cipher.getAuthTag(),
    recipientFingerprint: fingerprint(recipientEmail, key, 1),
  };
}

export function encryptPasswordResetRecoveryTokenV2(
  publicToken: string,
  recipientEmail: string,
  context: PasswordResetRecoveryContextV2
): PasswordResetRecoveryEnvelope {
  if (!PUBLIC_TOKEN_PATTERN.test(publicToken) || context.providerOperationId !== context.flowId) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
  }
  const ring = parseKeyRing();
  const activeKeyId = ring.activeKeyId!;
  const key = ring.keys.get(activeKeyId)!;
  const recipientFingerprint = fingerprint(recipientEmail, key, 2);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadV2(context, activeKeyId, recipientFingerprint));
  const ciphertext = Buffer.concat([cipher.update(publicToken, 'utf8'), cipher.final()]);

  return {
    cipherVersion: 2,
    keyId: activeKeyId,
    nonce,
    ciphertext,
    authTag: cipher.getAuthTag(),
    recipientFingerprint,
  };
}

export function decryptPasswordResetRecoveryToken(
  envelope: Pick<
    PasswordResetRecoveryEnvelope,
    'cipherVersion' | 'keyId' | 'nonce' | 'ciphertext' | 'authTag'
  >,
  recipientEmail: string,
  expectedRecipientFingerprint: string,
  context: PasswordResetRecoveryContext | PasswordResetRecoveryContextV2
): string {
  // Decryption needs only the key named by the row. A missing or stale active
  // writer key must not make a retained previous key unusable.
  const ring = parseKeyRing(false);
  const key = ring.keys.get(envelope.keyId);
  if (!key) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_KEY_UNAVAILABLE');
  }
  if (
    (envelope.cipherVersion !== 1 && envelope.cipherVersion !== 2) ||
    envelope.nonce.length !== NONCE_BYTES ||
    envelope.authTag.length !== TAG_BYTES ||
    envelope.ciphertext.length < 48 ||
    envelope.ciphertext.length > 128
  ) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
  }

  const actualFingerprint = fingerprint(recipientEmail, key, envelope.cipherVersion);
  const expectedFingerprint = Buffer.from(expectedRecipientFingerprint, 'utf8');
  const actualFingerprintBytes = Buffer.from(actualFingerprint, 'utf8');
  if (
    expectedFingerprint.length !== actualFingerprintBytes.length ||
    !timingSafeEqual(expectedFingerprint, actualFingerprintBytes)
  ) {
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_TOKEN_MISMATCH');
  }

  try {
    let authenticatedData: Buffer;
    if (envelope.cipherVersion === 1) {
      if (!('userId' in context) || !('expiresAt' in context)) {
        throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
      }
      authenticatedData = aadV1(context, envelope.keyId);
    } else {
      if (!('providerOperationId' in context) || context.providerOperationId !== context.flowId) {
        throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
      }
      authenticatedData = aadV2(context, envelope.keyId, expectedRecipientFingerprint);
    }
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(authenticatedData);
    decipher.setAuthTag(envelope.authTag);
    const publicToken = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]).toString('utf8');
    if (
      !PUBLIC_TOKEN_PATTERN.test(publicToken) ||
      !passwordResetTokenMatchesStoredValue(publicToken, context.storedToken)
    ) {
      throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_TOKEN_MISMATCH');
    }
    return publicToken;
  } catch (error) {
    if (error instanceof PasswordResetRecoveryError) {
      throw error;
    }
    throw new PasswordResetRecoveryError('PASSWORD_RESET_RECOVERY_ENVELOPE_INVALID');
  }
}
