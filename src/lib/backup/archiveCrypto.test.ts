import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

import { __test__, BackupCryptoError } from './archiveCrypto';

const { seal, open, requireKek } = __test__;

describe('archiveCrypto envelope (AES-256-GCM)', () => {
  beforeEach(() => {
    process.env['BACKUP_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
  });

  it('seal → open round-trips arbitrary bytes', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('tenant secrets: password hashes, 2fa, doc keys');
    expect(open(key, seal(key, plaintext)).equals(plaintext)).toBe(true);
  });

  it('uses a unique nonce per seal (no nonce reuse under one key)', () => {
    const key = randomBytes(32);
    const a = seal(key, Buffer.from('x'));
    const b = seal(key, Buffer.from('x'));
    expect(a.nonce).not.toEqual(b.nonce);
    expect(open(key, a).equals(Buffer.from('x'))).toBe(true);
    expect(open(key, b).equals(Buffer.from('x'))).toBe(true);
  });

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const key = randomBytes(32);
    const sealed = seal(key, Buffer.from('important'));
    const bad = { ...sealed, ciphertext: Buffer.from('tampered!!').toString('base64') };
    expect(() => open(key, bad)).toThrow();
  });

  it('rejects decryption under the wrong key', () => {
    const sealed = seal(randomBytes(32), Buffer.from('secret'));
    expect(() => open(randomBytes(32), sealed)).toThrow();
  });

  it('requireKek rejects a missing or wrong-size key', () => {
    delete process.env['BACKUP_ENCRYPTION_KEY'];
    expect(() => requireKek()).toThrow(BackupCryptoError);
    process.env['BACKUP_ENCRYPTION_KEY'] = Buffer.from('too-short').toString('base64');
    expect(() => requireKek()).toThrow(BackupCryptoError);
  });
});
