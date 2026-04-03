/**
 * Share Links API Tests (F116)
 *
 * Tests for share link creation and management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

// Mock auth middleware
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('GET /api/rooms/:roomId/links', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);
  });

  it('returns 500 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/rooms/room-1/links');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(500);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/rooms/room-1/links');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(403);
  });

  it('returns 404 when room not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns list of links for valid room', async () => {
    const mockLinks = [
      {
        id: 'link-1',
        slug: 'abc123',
        name: 'Investor Link',
        permission: 'VIEW',
        scope: 'ENTIRE_ROOM',
        createdByUser: { id: 'user-1', firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
        _count: { visits: 5 },
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        link: { findMany: vi.fn().mockResolvedValue(mockLinks) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.links).toHaveLength(1);
    expect(body.links[0].name).toBe('Investor Link');
  });
});

describe('POST /api/rooms/:roomId/links', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);
    // Set required env var
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Link' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid permission level', async () => {
    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({ permission: 'ADMIN' }), // Not valid for links
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('permission');
  });

  it('returns 400 for invalid scope', async () => {
    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({ scope: 'INVALID' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('scope');
  });

  it('creates link successfully', async () => {
    const newLink = {
      id: 'link-new',
      slug: 'generated-slug',
      name: 'Investor Link',
      permission: 'VIEW',
      scope: 'ENTIRE_ROOM',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        link: {
          findFirst: vi.fn().mockResolvedValue(null), // No collision
          create: vi.fn().mockResolvedValue(newLink),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Investor Link',
        permission: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.link.name).toBe('Investor Link');
    expect(body.link.url).toContain('generated-slug');
  });

  it('creates link with password protection', async () => {
    const newLink = {
      id: 'link-new',
      slug: 'pw-slug',
      name: 'Protected Link',
      permission: 'VIEW',
      requiresPassword: true,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        link: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newLink),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Protected Link',
        password: 'secret123',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.link.requiresPassword).toBe(true);
  });

  it('creates folder-scoped link', async () => {
    const newLink = {
      id: 'link-folder',
      slug: 'folder-slug',
      name: 'Folder Link',
      permission: 'DOWNLOAD',
      scope: 'FOLDER',
      scopedFolderId: 'folder-1',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        folder: { findFirst: vi.fn().mockResolvedValue({ id: 'folder-1' }) },
        link: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newLink),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Folder Link',
        permission: 'DOWNLOAD',
        scope: 'FOLDER',
        scopedFolderId: 'folder-1',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.link.scope).toBe('FOLDER');
  });

  it('returns 404 when scoped folder not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        folder: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'FOLDER',
        scopedFolderId: 'nonexistent',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('Folder');
  });
});
