import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn() }));

vi.mock('jose', () => {
  const customFetch = Symbol('customFetch');
  class JOSEError extends Error {}
  class JWKSTimeout extends JOSEError {}
  class JWKSInvalid extends JOSEError {}
  class JWKInvalid extends JOSEError {}
  class JWKSNoMatchingKey extends JOSEError {}
  class JWSSignatureVerificationFailed extends JOSEError {}
  class JWTExpired extends JOSEError {}
  class JOSEAlgNotAllowed extends JOSEError {}
  return {
    createRemoteJWKSet: mocks.createRemoteJWKSet,
    jwtVerify: mocks.jwtVerify,
    customFetch,
    errors: {
      JOSEError,
      JWKSTimeout,
      JWKSInvalid,
      JWKInvalid,
      JWKSNoMatchingKey,
      JWSSignatureVerificationFailed,
      JWTExpired,
      JOSEAlgNotAllowed,
    },
  };
});

import { errors } from 'jose';
import { authenticateEventGridRequest, fetchEventGridJwks } from './eventGridAuth';

const configuration = {
  enabled: true,
  tenantId: '11111111-1111-4111-8111-111111111111',
  audience: '44444444-4444-4444-8444-444444444444',
  callerAppId: '22222222-2222-4222-8222-222222222222',
  callerObjectId: null,
  requiredRole: 'AzureEventGridSecureWebhookSubscriber',
  sources: [],
  activeFingerprintKeyId: 'key',
  fingerprintKeys: new Map([['key', Buffer.alloc(32)]]),
  expectedInboxOwner: 'vaultspace_migrator',
};

describe('Event Grid Entra authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createRemoteJWKSet.mockReturnValue(vi.fn());
    mocks.jwtVerify.mockResolvedValue({
      payload: {
        tid: configuration.tenantId,
        ver: '2.0',
        idtyp: 'app',
        azp: configuration.callerAppId,
        roles: [configuration.requiredRole],
      },
    });
  });

  it('pins issuer, audience, algorithm, caller application, and app role', async () => {
    await expect(
      authenticateEventGridRequest('Bearer a.b.c', configuration)
    ).resolves.toBeUndefined();
    expect(mocks.jwtVerify).toHaveBeenCalledWith(
      'a.b.c',
      expect.anything(),
      expect.objectContaining({
        algorithms: ['RS256'],
        issuer: `https://login.microsoftonline.com/${configuration.tenantId}/v2.0`,
        audience: configuration.audience,
        requiredClaims: expect.arrayContaining(['exp', 'iat', 'nbf', 'idtyp', 'azp', 'roles']),
        clockTolerance: 60,
      })
    );
    expect(mocks.jwtVerify.mock.calls[0]![2]).not.toHaveProperty('maxTokenAge');
  });

  it('rejects another role-bearing application', async () => {
    mocks.jwtVerify.mockResolvedValue({
      payload: {
        tid: configuration.tenantId,
        ver: '2.0',
        idtyp: 'app',
        azp: '33333333-3333-4333-8333-333333333333',
        roles: [configuration.requiredRole],
      },
    });
    await expect(authenticateEventGridRequest('Bearer a.b.c', configuration)).rejects.toMatchObject(
      {
        code: 'EVENT_GRID_CALLER_FORBIDDEN',
        status: 403,
      }
    );
  });

  it('maps identity infrastructure failures to retryable 503', async () => {
    mocks.jwtVerify.mockRejectedValue(new TypeError('fetch failed'));
    await expect(authenticateEventGridRequest('Bearer a.b.c', configuration)).rejects.toMatchObject(
      {
        code: 'EVENT_GRID_IDENTITY_PROVIDER_UNAVAILABLE',
        status: 503,
      }
    );
  });

  it.each([429, 500])('maps a JWKS HTTP %s response to identity unavailability', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status })));
    await expect(
      fetchEventGridJwks('https://login.microsoftonline.com/tenant/keys', {
        headers: new Headers(),
        method: 'GET',
        redirect: 'manual',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/JWKS_RESPONSE_UNAVAILABLE/);
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['invalid key set', JSON.stringify({ keys: [] })],
  ])('maps %s from JWKS to identity unavailability', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(
      fetchEventGridJwks('https://login.microsoftonline.com/tenant/keys', {
        headers: new Headers(),
        method: 'GET',
        redirect: 'manual',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/JWKS_RESPONSE_INVALID/);
  });

  it('returns retryable 503 for an unknown key while the JWKS cache is cooling down', async () => {
    mocks.jwtVerify.mockRejectedValue(new errors.JWKSNoMatchingKey());
    await expect(authenticateEventGridRequest('Bearer a.b.c', configuration)).rejects.toMatchObject(
      { code: 'EVENT_GRID_IDENTITY_KEY_NOT_READY', status: 503 }
    );
  });

  it('returns 401 for an unknown key after a successful JWKS refresh', async () => {
    mocks.jwtVerify.mockImplementation(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ keys: [{ kty: 'RSA', kid: 'new-key' }] }), {
            status: 200,
          })
        )
      );
      await fetchEventGridJwks('https://login.microsoftonline.com/tenant/keys', {
        headers: new Headers(),
        method: 'GET',
        redirect: 'manual',
        signal: new AbortController().signal,
      });
      throw new errors.JWKSNoMatchingKey();
    });
    await expect(authenticateEventGridRequest('Bearer a.b.c', configuration)).rejects.toMatchObject(
      { code: 'EVENT_GRID_TOKEN_INVALID', status: 401 }
    );
  });

  it.each([new errors.JWKSTimeout(), new errors.JWKSInvalid(), new errors.JWKInvalid()])(
    'maps JWKS infrastructure error %# to 503',
    async (error) => {
      mocks.jwtVerify.mockRejectedValue(error);
      await expect(
        authenticateEventGridRequest('Bearer a.b.c', configuration)
      ).rejects.toMatchObject({ code: 'EVENT_GRID_IDENTITY_PROVIDER_UNAVAILABLE', status: 503 });
    }
  );

  it.each([
    new errors.JWSSignatureVerificationFailed(),
    new errors.JWTExpired('token expired', {}, 'exp', 'check_failed'),
    new errors.JOSEAlgNotAllowed(),
  ])('maps invalid token error %# to 401', async (error) => {
    mocks.jwtVerify.mockRejectedValue(error);
    await expect(authenticateEventGridRequest('Bearer a.b.c', configuration)).rejects.toMatchObject(
      { code: 'EVENT_GRID_TOKEN_INVALID', status: 401 }
    );
  });
});
