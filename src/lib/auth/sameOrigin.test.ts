import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isSameOriginRequest } from './sameOrigin';

describe('cookie-backed identity mutation origin', () => {
  const url = 'https://www.vaultspace.org/api/auth/account-switch';
  const proxiedUrl = 'http://localhost:3000/api/auth/account-switch';

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

  it.each(['vaultspace.org', 'www.vaultspace.org', 'customer.example'])(
    'accepts the public HTTPS origin behind ingress for %s',
    (host) => {
      expect(
        isSameOriginRequest(
          new NextRequest(proxiedUrl, {
            method: 'POST',
            headers: {
              origin: `https://${host}`,
              host,
              'x-forwarded-proto': 'https',
            },
          })
        )
      ).toBe(true);
    }
  );

  it.each([
    { origin: 'https://attacker.example', host: 'vaultspace.org', proto: 'https' },
    { origin: 'http://vaultspace.org', host: 'vaultspace.org', proto: 'https' },
    { origin: 'https://vaultspace.org', host: 'vaultspace.org', proto: 'http' },
    { origin: 'https://vaultspace.org/path', host: 'vaultspace.org', proto: 'https' },
    { origin: 'https://vaultspace.org', host: 'vaultspace.org', proto: 'https,http' },
  ])('rejects a mismatched or malformed proxied origin: $origin', ({ origin, host, proto }) => {
    expect(
      isSameOriginRequest(
        new NextRequest(proxiedUrl, {
          method: 'POST',
          headers: { origin, host, 'x-forwarded-proto': proto },
        })
      )
    ).toBe(false);
  });

  it('does not trust a client-supplied forwarded host in place of Host', () => {
    expect(
      isSameOriginRequest(
        new NextRequest(proxiedUrl, {
          method: 'POST',
          headers: {
            origin: 'https://attacker.example',
            host: 'vaultspace.org',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
          },
        })
      )
    ).toBe(false);
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
