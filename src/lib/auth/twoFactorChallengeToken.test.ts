import { describe, expect, it } from 'vitest';

import {
  generateTwoFactorChallengeToken,
  hashTwoFactorChallengeToken,
} from './twoFactorChallengeToken';

describe('two-factor challenge token', () => {
  it('creates opaque 256-bit URL-safe tokens and only hashes valid tokens', () => {
    const token = generateTwoFactorChallengeToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashTwoFactorChallengeToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTwoFactorChallengeToken('user-1:timestamp:signature')).toBeNull();
    expect(hashTwoFactorChallengeToken('short')).toBeNull();
  });
});
