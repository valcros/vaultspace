import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';

import type { AcsEventGridConfiguration } from './acsEventGridConfig';

export class EventGridAuthenticationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 401 | 403 | 503
  ) {
    super(code);
    this.name = 'EventGridAuthenticationError';
  }
}

let cachedTenantId: string | null = null;
let cachedKeySet: ReturnType<typeof createRemoteJWKSet> | null = null;
let successfulJwksFetchGeneration = 0;

class EventGridIdentityProviderUnavailableError extends Error {}

export async function fetchEventGridJwks(
  url: string,
  options: {
    headers: Headers;
    method: 'GET';
    redirect: 'manual';
    signal: AbortSignal;
  }
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new EventGridIdentityProviderUnavailableError('JWKS_FETCH_FAILED', { cause: error });
  }
  if (response.status !== 200) {
    throw new EventGridIdentityProviderUnavailableError('JWKS_RESPONSE_UNAVAILABLE');
  }
  try {
    const body = await response.clone().text();
    if (body.length > 256 * 1024) {
      throw new Error('JWKS_RESPONSE_TOO_LARGE');
    }
    const parsed = JSON.parse(body) as { keys?: unknown };
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.keys) ||
      parsed.keys.length === 0 ||
      !parsed.keys.every((key) => key && typeof key === 'object' && !Array.isArray(key))
    ) {
      throw new Error('JWKS_RESPONSE_INVALID');
    }
  } catch (error) {
    throw new EventGridIdentityProviderUnavailableError('JWKS_RESPONSE_INVALID', { cause: error });
  }
  successfulJwksFetchGeneration += 1;
  return response;
}

function keySetFor(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedKeySet || cachedTenantId !== tenantId) {
    cachedTenantId = tenantId;
    cachedKeySet = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
      {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
        [customFetch]: fetchEventGridJwks,
      }
    );
  }
  return cachedKeySet;
}

export async function authenticateEventGridRequest(
  authorization: string | null,
  configuration: AcsEventGridConfiguration
): Promise<void> {
  if (!authorization || authorization.length > 8192) {
    throw new EventGridAuthenticationError('EVENT_GRID_AUTHORIZATION_MISSING', 401);
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  if (!match || match[1]!.length > 8000) {
    throw new EventGridAuthenticationError('EVENT_GRID_AUTHORIZATION_INVALID', 401);
  }

  const keySet = keySetFor(configuration.tenantId);
  const fetchGenerationBeforeVerification = successfulJwksFetchGeneration;
  const verify = () =>
    jwtVerify(match[1]!, keySet, {
      algorithms: ['RS256'],
      issuer: `https://login.microsoftonline.com/${configuration.tenantId}/v2.0`,
      audience: configuration.audience,
      requiredClaims: ['exp', 'iat', 'nbf', 'tid', 'ver', 'idtyp', 'azp', 'roles'],
      clockTolerance: 60,
    });

  let payload;
  try {
    ({ payload } = await verify());
  } catch (error) {
    if (error instanceof errors.JWKSNoMatchingKey) {
      if (successfulJwksFetchGeneration === fetchGenerationBeforeVerification) {
        throw new EventGridAuthenticationError('EVENT_GRID_IDENTITY_KEY_NOT_READY', 503);
      }
      throw new EventGridAuthenticationError('EVENT_GRID_TOKEN_INVALID', 401);
    } else if (
      error instanceof EventGridIdentityProviderUnavailableError ||
      error instanceof errors.JWKSTimeout ||
      error instanceof errors.JWKSInvalid ||
      error instanceof errors.JWKInvalid ||
      !(error instanceof errors.JOSEError)
    ) {
      throw new EventGridAuthenticationError('EVENT_GRID_IDENTITY_PROVIDER_UNAVAILABLE', 503);
    } else {
      throw new EventGridAuthenticationError('EVENT_GRID_TOKEN_INVALID', 401);
    }
  }

  const roles = Array.isArray(payload['roles']) ? payload['roles'] : [];
  if (
    payload['tid'] !== configuration.tenantId ||
    payload['ver'] !== '2.0' ||
    payload['idtyp'] !== 'app' ||
    payload['azp'] !== configuration.callerAppId ||
    typeof payload['scp'] === 'string' ||
    !roles.includes(configuration.requiredRole) ||
    (configuration.callerObjectId !== null && payload['oid'] !== configuration.callerObjectId)
  ) {
    throw new EventGridAuthenticationError('EVENT_GRID_CALLER_FORBIDDEN', 403);
  }
}
