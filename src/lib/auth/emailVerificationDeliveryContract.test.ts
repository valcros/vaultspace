import { beforeEach, describe, expect, it } from 'vitest';

import {
  decryptEmailVerificationRecoveryToken,
  encryptEmailVerificationRecoveryToken,
  getEmailVerificationDeliveryMode,
  validateEmailVerificationDeliveryUrlConfiguration,
} from './emailVerificationDeliveryContract';

const publicToken = 'evt1_' + 'a'.repeat(43);
const storedToken = 'evh1:' + 'b'.repeat(64);
const context = {
  flowId: 'flow-1',
  storedToken,
  expiresAt: new Date('2026-09-03T00:00:00.000Z'),
};

describe('emailVerificationDeliveryContract', () => {
  beforeEach(() => {
    process.env['EMAIL_VERIFICATION_RECOVERY_KEYS'] = JSON.stringify({
      'verify-test': Buffer.alloc(32, 7).toString('base64'),
    });
    process.env['EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_ID'] = 'verify-test';
    delete process.env['EMAIL_VERIFICATION_DELIVERY_MODE'];
    process.env['APP_URL'] = 'https://vaultspace.test';
  });

  it('defaults to legacy until durable mode is explicitly activated', () => {
    expect(getEmailVerificationDeliveryMode()).toBe('legacy');
    process.env['EMAIL_VERIFICATION_DELIVERY_MODE'] = 'durable';
    expect(getEmailVerificationDeliveryMode()).toBe('durable');
  });

  it('requires an absolute application URL before durable delivery can start', () => {
    expect(() => validateEmailVerificationDeliveryUrlConfiguration()).not.toThrow();
    delete process.env['APP_URL'];
    expect(() => validateEmailVerificationDeliveryUrlConfiguration()).toThrow(
      'EMAIL_VERIFICATION_APP_URL_MISSING'
    );
  });

  it('round-trips only when the immutable flow context and recipient match', () => {
    const envelope = encryptEmailVerificationRecoveryToken(
      publicToken,
      'alice@example.com',
      context
    );
    expect(decryptEmailVerificationRecoveryToken(envelope, 'alice@example.com', context)).toBe(
      publicToken
    );
    expect(() =>
      decryptEmailVerificationRecoveryToken(envelope, 'alice@example.com', {
        ...context,
        flowId: 'other-flow',
      })
    ).toThrow('Email verification delivery recovery configuration or envelope is invalid');
    expect(() =>
      decryptEmailVerificationRecoveryToken(envelope, 'bob@example.com', context)
    ).toThrow('Email verification delivery recovery configuration or envelope is invalid');
  });

  it('rejects a tampered encrypted envelope', () => {
    const envelope = encryptEmailVerificationRecoveryToken(
      publicToken,
      'alice@example.com',
      context
    );
    const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;
    expect(() =>
      decryptEmailVerificationRecoveryToken(tampered, 'alice@example.com', context)
    ).toThrow('Email verification delivery recovery configuration or envelope is invalid');
  });
});
