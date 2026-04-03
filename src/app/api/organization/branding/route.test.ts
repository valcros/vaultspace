/**
 * Organization Branding API Tests (F033)
 *
 * Tests for branded viewer - organization branding settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from './route';

// Mock auth middleware
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('GET /api/organization/branding', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 500 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it('returns 404 when organization not found', async () => {
    mockWithOrgContext.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(404);
  });

  it('returns branding settings', async () => {
    const mockOrg = {
      id: 'org-1',
      name: 'Acme Corp',
      slug: 'acme',
      logoUrl: 'https://example.com/logo.png',
      primaryColor: '#2563eb',
      faviconUrl: 'https://example.com/favicon.ico',
    };

    mockWithOrgContext.mockResolvedValue(mockOrg);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.branding.name).toBe('Acme Corp');
    expect(body.branding.primaryColor).toBe('#2563eb');
    expect(body.branding.logoUrl).toBe('https://example.com/logo.png');
  });

  it('allows non-admin users to read branding', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const mockOrg = {
      id: 'org-1',
      name: 'Acme Corp',
      slug: 'acme',
      logoUrl: null,
      primaryColor: null,
      faviconUrl: null,
    };

    mockWithOrgContext.mockResolvedValue(mockOrg);

    const response = await GET();
    expect(response.status).toBe(200);
  });
});

describe('PATCH /api/organization/branding', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for empty organization name', async () => {
    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('organization name');
  });

  it('returns 400 for invalid hex color', async () => {
    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ primaryColor: 'red' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('hex');
  });

  it('returns 400 for invalid logo URL', async () => {
    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'not-a-url' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('logoUrl');
  });

  it('updates branding successfully', async () => {
    const updatedOrg = {
      id: 'org-1',
      name: 'New Acme Corp',
      slug: 'acme',
      logoUrl: 'https://example.com/new-logo.png',
      primaryColor: '#dc2626',
      faviconUrl: null,
    };

    mockWithOrgContext.mockResolvedValue(updatedOrg);

    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'New Acme Corp',
        logoUrl: 'https://example.com/new-logo.png',
        primaryColor: '#dc2626',
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.branding.name).toBe('New Acme Corp');
    expect(body.branding.primaryColor).toBe('#dc2626');
  });

  it('accepts short hex color format', async () => {
    const updatedOrg = {
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      logoUrl: null,
      primaryColor: '#f00',
      faviconUrl: null,
    };

    mockWithOrgContext.mockResolvedValue(updatedOrg);

    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ primaryColor: '#f00' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
  });

  it('allows clearing optional fields', async () => {
    const updatedOrg = {
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      logoUrl: null,
      primaryColor: null,
      faviconUrl: null,
    };

    mockWithOrgContext.mockResolvedValue(updatedOrg);

    const request = new NextRequest('http://localhost/api/organization/branding', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: '' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
  });
});
