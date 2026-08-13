import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolveOrganizationBySlug = vi.fn();
const mockResolveOrganizationByCustomDomain = vi.fn();
const mockValidateSession = vi.fn();
const mockCookieGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (...args: unknown[]) => mockCookieGet(...args) }),
}));

vi.mock('../auth', () => ({
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

vi.mock('../auth/bootstrapRepository', () => ({
  BootstrapRepository: class {
    resolveSession() {
      return null;
    }
  },
  bootstrapRepository: {
    resolveOrganizationBySlug: (...args: unknown[]) => mockResolveOrganizationBySlug(...args),
    resolveOrganizationByCustomDomain: (...args: unknown[]) =>
      mockResolveOrganizationByCustomDomain(...args),
  },
}));

import { getRequestContext, requireAuthCredential, resolveOrganizationFromHeaders } from './auth';

const organizationProjection = {
  id: 'org-1',
  name: 'CloudVault',
  slug: 'cloudvault',
  customDomain: 'data-room.example.test',
  logoUrl: 'https://assets.example.test/logo.png',
  primaryColor: '#2563eb',
  faviconUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAuthCredential', () => {
  it('returns the validated session and exact server-only cookie token', async () => {
    const token = 's'.repeat(43);
    const session = { sessionId: 'session-1', userId: 'user-1', organizationId: 'org-1' };
    mockCookieGet.mockReturnValue({ value: token });
    mockValidateSession.mockResolvedValue(session);

    await expect(requireAuthCredential()).resolves.toEqual({ session, token });
    expect(mockValidateSession).toHaveBeenCalledWith(token);
  });

  it('fails closed without returning the cookie when validation fails', async () => {
    mockCookieGet.mockReturnValue({ value: 's'.repeat(43) });
    mockValidateSession.mockRejectedValue(new Error('invalid session'));

    await expect(requireAuthCredential()).rejects.toMatchObject({
      name: 'AuthenticationError',
    });
  });
});

describe('getRequestContext request id validation', () => {
  it('preserves a bounded safe upstream request id', () => {
    const request = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'gateway:request-123' },
    });

    expect(getRequestContext(request).requestId).toBe('gateway:request-123');
  });

  it('replaces an oversized or unsafe request id before database use', () => {
    const oversized = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'x'.repeat(101) },
    });
    const unsafe = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'request with spaces' },
    });

    expect(getRequestContext(oversized).requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(getRequestContext(unsafe).requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });
});

describe('resolveOrganizationFromHeaders', () => {
  it('prefers the canonical slug and returns the complete public projection', async () => {
    mockResolveOrganizationBySlug.mockResolvedValue(organizationProjection);

    await expect(
      resolveOrganizationFromHeaders({
        orgSlug: 'cloudvault',
        customHost: 'data-room.example.test',
      })
    ).resolves.toEqual(organizationProjection);

    expect(mockResolveOrganizationBySlug).toHaveBeenCalledWith('cloudvault');
    expect(mockResolveOrganizationByCustomDomain).not.toHaveBeenCalled();
  });

  it('falls back to the custom domain when the slug has no active match', async () => {
    mockResolveOrganizationBySlug.mockResolvedValue(null);
    mockResolveOrganizationByCustomDomain.mockResolvedValue(organizationProjection);

    await expect(
      resolveOrganizationFromHeaders({
        orgSlug: 'missing-org',
        customHost: 'data-room.example.test',
      })
    ).resolves.toEqual(organizationProjection);

    expect(mockResolveOrganizationByCustomDomain).toHaveBeenCalledWith('data-room.example.test');
  });

  it('returns null without an administrative fallback', async () => {
    mockResolveOrganizationBySlug.mockResolvedValue(null);
    mockResolveOrganizationByCustomDomain.mockResolvedValue(null);

    await expect(
      resolveOrganizationFromHeaders({ orgSlug: 'missing-org', customHost: 'missing.test' })
    ).resolves.toBeNull();
  });
});
