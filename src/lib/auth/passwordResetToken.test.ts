import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPasswordResetToken,
  isStoredPasswordResetDigest,
  PasswordResetTokenConfigurationError,
  passwordResetTokenMatchesStoredValue,
  requirePasswordResetTokenSecret,
  resolvePasswordResetTokenLookup,
} from './passwordResetToken';

const ORIGINAL_SECRET = process.env['SESSION_SECRET'];
const ORIGINAL_MODE = process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];

describe('passwordResetToken', () => {
  beforeEach(() => {
    process.env['SESSION_SECRET'] = 'test-session-secret-with-sufficient-entropy';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env['SESSION_SECRET'];
    } else {
      process.env['SESSION_SECRET'] = ORIGINAL_SECRET;
    }
    if (ORIGINAL_MODE === undefined) {
      delete process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];
    } else {
      process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = ORIGINAL_MODE;
    }
  });

  it('creates disjoint public and stored HMAC token formats', () => {
    const pair = createPasswordResetToken();

    expect(pair.publicToken).toMatch(/^prt1_[A-Za-z0-9_-]{43}$/);
    expect(pair.storedToken).toMatch(/^prh1:[a-f0-9]{64}$/);
    expect(pair.storedToken).not.toContain(pair.publicToken);
    expect(isStoredPasswordResetDigest(pair.storedToken)).toBe(true);
  });

  it('uses the stable purpose-separated HMAC construction', () => {
    const publicToken = `prt1_${'A'.repeat(43)}`;
    expect(resolvePasswordResetTokenLookup(publicToken)).toEqual({
      storedToken: 'prh1:33c70e0cef6cca319133d6f56bbdbde8c9598b04d422da771fe4b225d1de054a',
      format: 'hmac',
    });
  });

  it('resolves and defensively verifies a valid new public token', () => {
    const pair = createPasswordResetToken();

    expect(resolvePasswordResetTokenLookup(pair.publicToken)).toEqual({
      storedToken: pair.storedToken,
      format: 'hmac',
    });
    expect(passwordResetTokenMatchesStoredValue(pair.publicToken, pair.storedToken)).toBe(true);
    const last = pair.publicToken.at(-1);
    const replacement = last === 'A' ? 'B' : 'A';
    expect(
      passwordResetTokenMatchesStoredValue(
        `${pair.publicToken.slice(0, -1)}${replacement}`,
        pair.storedToken
      )
    ).toBe(false);
  });

  it('rejects stored-digest replay and malformed or unknown formats', () => {
    const pair = createPasswordResetToken();

    expect(resolvePasswordResetTokenLookup(pair.storedToken)).toBeNull();
    expect(resolvePasswordResetTokenLookup(pair.storedToken.slice(5))).toBeNull();
    expect(resolvePasswordResetTokenLookup('prt2_' + 'A'.repeat(43))).toBeNull();
    expect(resolvePasswordResetTokenLookup('prt1_' + 'A'.repeat(42))).toBeNull();
    expect(resolvePasswordResetTokenLookup('A'.repeat(500))).toBeNull();
    expect(resolvePasswordResetTokenLookup('é'.repeat(43))).toBeNull();
  });

  it('accepts only the exact historical legacy token shape', () => {
    const legacy = 'A'.repeat(43);
    expect(resolvePasswordResetTokenLookup(legacy)).toEqual({
      storedToken: legacy,
      format: 'legacy',
    });
    expect(passwordResetTokenMatchesStoredValue(legacy, legacy)).toBe(true);
  });

  it('continues legacy writes until the explicit activation flag is set', () => {
    delete process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];
    const pair = createPasswordResetToken();

    expect(pair).toEqual({
      publicToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      storedToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      format: 'legacy',
    });
    expect(pair.publicToken).toBe(pair.storedToken);
  });

  it.each(['legacy', 'hmac'] as const)('accepts the explicit %s write mode', (mode) => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = mode;
    expect(createPasswordResetToken().format).toBe(mode);
  });

  it.each(['HMAC', 'hmca', ' ', 'legacy '])('fails closed for invalid write mode %j', (mode) => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = mode;
    expect(() => createPasswordResetToken()).toThrow(PasswordResetTokenConfigurationError);
  });

  it('fails closed when the secret is missing or whitespace-only', () => {
    delete process.env['SESSION_SECRET'];
    expect(() => requirePasswordResetTokenSecret()).toThrow(PasswordResetTokenConfigurationError);
    process.env['SESSION_SECRET'] = '   ';
    expect(() => resolvePasswordResetTokenLookup('A'.repeat(43))).toThrow(
      PasswordResetTokenConfigurationError
    );
  });
});
