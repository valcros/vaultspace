import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isSameOriginRequest } from './sameOrigin';

describe('cookie-backed identity mutation origin', () => {
  const url = 'https://www.vaultspace.org/api/auth/account-switch';

  it('accepts an explicit same-origin browser request', () => {
    expect(
      isSameOriginRequest(
        new NextRequest(url, {
          method: 'POST',
          headers: { origin: 'https://www.vaultspace.org' },
        })
      )
    ).toBe(true);
  });

  it.each([undefined, 'https://attacker.example', 'http://www.vaultspace.org'])(
    'rejects absent, cross-site, or downgraded origin %s',
    (origin) => {
      expect(
        isSameOriginRequest(
          new NextRequest(url, {
            method: 'POST',
            headers: origin ? { origin } : {},
          })
        )
      ).toBe(false);
    }
  );
});
