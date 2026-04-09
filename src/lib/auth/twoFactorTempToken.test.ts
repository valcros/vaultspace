import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateTwoFactorTempToken, verifyTwoFactorTempToken } from './twoFactorTempToken';

const originalSessionSecret = process.env['SESSION_SECRET'];

describe('twoFactorTempToken', () => {
  beforeEach(() => {
    delete process.env['SESSION_SECRET'];
  });

  afterEach(() => {
    if (originalSessionSecret === undefined) {
      delete process.env['SESSION_SECRET'];
      return;
    }

    process.env['SESSION_SECRET'] = originalSessionSecret;
  });

  it('throws when SESSION_SECRET is missing', () => {
    expect(() => generateTwoFactorTempToken('user-1')).toThrow(
      'SESSION_SECRET is required for 2FA temp token signing'
    );
  });

  it('round-trips a valid temp token when SESSION_SECRET is configured', () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';

    const now = Date.now();
    const token = generateTwoFactorTempToken('user-1', now);

    expect(verifyTwoFactorTempToken(token, now + 1000)).toEqual({ userId: 'user-1' });
  });

  it('rejects future-dated temp tokens', () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';

    const now = Date.now();
    const token = generateTwoFactorTempToken('user-1', now + 1000);

    expect(verifyTwoFactorTempToken(token, now)).toBeNull();
  });
});
