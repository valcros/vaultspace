import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPasswordResetToken } from './passwordResetToken';
import {
  decryptPasswordResetRecoveryToken,
  encryptPasswordResetRecoveryToken,
  PasswordResetRecoveryError,
  validatePasswordResetRecoveryConfiguration,
} from './passwordResetRecovery';

const ORIGINAL_ENV = { ...process.env };

describe('password reset recovery envelope', () => {
  beforeEach(() => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'key-2026-07';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'key-2026-07': randomBytes(32).toString('base64'),
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function fixture() {
    const pair = createPasswordResetToken();
    const context = {
      flowId: 'flow-1',
      userId: 'user-1',
      storedToken: pair.storedToken,
      expiresAt: new Date('2026-07-31T01:00:00.000Z'),
    };
    const envelope = encryptPasswordResetRecoveryToken(
      pair.publicToken,
      'user@example.com',
      context
    );
    return { pair, context, envelope };
  }

  it('round trips a HMAC token with row-bound authenticated data', () => {
    const { pair, context, envelope } = fixture();
    expect(
      decryptPasswordResetRecoveryToken(
        envelope,
        'USER@example.com',
        envelope.recipientFingerprint,
        context
      )
    ).toBe(pair.publicToken);
  });

  it.each(['nonce', 'ciphertext', 'authTag'] as const)('rejects modified %s', (field) => {
    const { context, envelope } = fixture();
    const modified = { ...envelope, [field]: Buffer.from(envelope[field]) };
    modified[field][0] = modified[field][0]! ^ 1;
    expect(() =>
      decryptPasswordResetRecoveryToken(
        modified,
        'user@example.com',
        envelope.recipientFingerprint,
        context
      )
    ).toThrow(PasswordResetRecoveryError);
  });

  it('rejects movement to another flow and a changed stored digest', () => {
    const { context, envelope } = fixture();
    expect(() =>
      decryptPasswordResetRecoveryToken(
        envelope,
        'user@example.com',
        envelope.recipientFingerprint,
        { ...context, flowId: 'flow-2' }
      )
    ).toThrow(PasswordResetRecoveryError);
    expect(() =>
      decryptPasswordResetRecoveryToken(
        envelope,
        'user@example.com',
        envelope.recipientFingerprint,
        { ...context, storedToken: `prh1:${'0'.repeat(64)}` }
      )
    ).toThrow(PasswordResetRecoveryError);
  });

  it('supports retained previous keys and rejects an unknown key id', () => {
    const { pair, context, envelope } = fixture();
    const oldKeys = JSON.parse(process.env['PASSWORD_RESET_RECOVERY_KEYS']!) as Record<
      string,
      string
    >;
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      ...oldKeys,
      'key-2026-08': randomBytes(32).toString('base64'),
    });
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'key-2026-08';
    expect(
      decryptPasswordResetRecoveryToken(
        envelope,
        'user@example.com',
        envelope.recipientFingerprint,
        context
      )
    ).toBe(pair.publicToken);
    expect(() =>
      decryptPasswordResetRecoveryToken(
        { ...envelope, keyId: 'retired-missing' },
        'user@example.com',
        envelope.recipientFingerprint,
        context
      )
    ).toThrow(PasswordResetRecoveryError);
  });

  it('fails closed for missing, malformed, and wrong-length key configuration', () => {
    delete process.env['PASSWORD_RESET_RECOVERY_KEYS'];
    expect(() => validatePasswordResetRecoveryConfiguration()).toThrow(PasswordResetRecoveryError);
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = '{';
    expect(() => validatePasswordResetRecoveryConfiguration()).toThrow(PasswordResetRecoveryError);
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({ active: 'AA==' });
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'active';
    expect(() => validatePasswordResetRecoveryConfiguration()).toThrow(PasswordResetRecoveryError);
  });
});
