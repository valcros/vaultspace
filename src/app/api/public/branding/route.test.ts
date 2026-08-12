import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetRequestContext = vi.fn();
const mockResolveOrganizationFromHeaders = vi.fn();

vi.mock('@/lib/middleware', () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  resolveOrganizationFromHeaders: (...args: unknown[]) =>
    mockResolveOrganizationFromHeaders(...args),
}));

import { GET } from './route';

const organizationProjection = {
  id: 'org-1',
  name: 'CloudVault',
  slug: 'cloudvault',
  customDomain: 'data-room.example.test',
  logoUrl: 'https://assets.example.test/logo.png',
  primaryColor: '#2563eb',
  faviconUrl: 'https://assets.example.test/favicon.ico',
};

describe('GET /api/public/branding organization conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestContext.mockReturnValue({
      customDomain: { orgSlug: 'cloudvault', customHost: null },
    });
  });

  it('returns only the public branding fields from the resolved projection', async () => {
    mockResolveOrganizationFromHeaders.mockResolvedValue(organizationProjection);

    const response = await GET(
      new NextRequest('https://cloudvault.vaultspace.org/api/public/branding')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      branding: {
        name: 'CloudVault',
        slug: 'cloudvault',
        logoUrl: 'https://assets.example.test/logo.png',
        primaryColor: '#2563eb',
        faviconUrl: 'https://assets.example.test/favicon.ico',
      },
      detected: true,
    });
  });

  it('returns the existing neutral response when no active organization resolves', async () => {
    mockResolveOrganizationFromHeaders.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('https://missing.vaultspace.org/api/public/branding')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ branding: null, detected: false });
  });

  it('returns a categorical 500 without logging database details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveOrganizationFromHeaders.mockRejectedValue(
      new Error('postgresql://sensitive-host/private-query')
    );

    const response = await GET(
      new NextRequest('https://cloudvault.vaultspace.org/api/public/branding')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to get branding' });
    expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
      component: 'public-branding',
      event: 'organization_lookup_failed',
      outcome: 'error',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive-host');
  });

  it('contains no direct administrative lookup or second organization query', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/public/branding/route.ts'),
      'utf8'
    );

    expect(source).not.toMatch(/\bbootstrapDb\b/);
    expect(source).not.toMatch(/organization\.(findFirst|findUnique)/);
    expect(source).toContain('branding: {');
  });
});
