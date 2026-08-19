import { describe, it, expect, beforeEach } from 'vitest';

import {
  createEmailVerificationToken,
  resolveStoredToken,
  emailVerificationTokenMatches,
  isStoredEmailVerificationDigest,
  EmailVerificationTokenConfigurationError,
} from './emailVerificationToken';

describe('emailVerificationToken', () => {
  beforeEach(() => {
    process.env['SESSION_SECRET'] = 'test-session-secret-value-for-hmac-derivation';
  });

  it('mints a public token and a distinct stored digest', () => {
    const { publicToken, storedToken } = createEmailVerificationToken();
    expect(publicToken).toMatch(/^evt1_[A-Za-z0-9_-]{43}$/);
    expect(storedToken).toMatch(/^evh1:[a-f0-9]{64}$/);
    expect(publicToken).not.toEqual(storedToken);
    expect(isStoredEmailVerificationDigest(storedToken)).toBe(true);
    // The plaintext public token must never itself look like a stored digest.
    expect(isStoredEmailVerificationDigest(publicToken)).toBe(false);
  });

  it('resolves a presented public token to its stored digest deterministically', () => {
    const { publicToken, storedToken } = createEmailVerificationToken();
    expect(resolveStoredToken(publicToken)).toEqual(storedToken);
  });

  it('matches a presented token against its stored digest (constant-time)', () => {
    const { publicToken, storedToken } = createEmailVerificationToken();
    expect(emailVerificationTokenMatches(publicToken, storedToken)).toBe(true);
  });

  it('rejects a tampered token', () => {
    const { publicToken, storedToken } = createEmailVerificationToken();
    const tampered = publicToken.slice(0, -1) + (publicToken.endsWith('A') ? 'B' : 'A');
    expect(emailVerificationTokenMatches(tampered, storedToken)).toBe(false);
  });

  it('fails closed on malformed tokens (no lookup value)', () => {
    expect(resolveStoredToken('not-a-token')).toBeNull();
    expect(resolveStoredToken('')).toBeNull();
    expect(resolveStoredToken('evt1_short')).toBeNull();
    expect(emailVerificationTokenMatches('garbage', 'evh1:' + 'a'.repeat(64))).toBe(false);
  });

  it('is bound to SESSION_SECRET — a different secret does not match', () => {
    const { publicToken, storedToken } = createEmailVerificationToken();
    process.env['SESSION_SECRET'] = 'a-completely-different-secret-value';
    expect(resolveStoredToken(publicToken)).not.toEqual(storedToken);
    expect(emailVerificationTokenMatches(publicToken, storedToken)).toBe(false);
  });

  it('throws when SESSION_SECRET is missing', () => {
    delete process.env['SESSION_SECRET'];
    expect(() => createEmailVerificationToken()).toThrow(EmailVerificationTokenConfigurationError);
  });
});
