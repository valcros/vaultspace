/**
 * Permissions API Tests (F005, F019)
 *
 * Tests for permission grant, list, update, and revoke operations.
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

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('GET /api/rooms/:roomId/permissions', () => {
  const mockSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(401);
  });

  it('returns 404 when room not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns permissions list for valid room', async () => {
    const mockPermissions = [
      {
        id: 'perm-1',
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'VIEW',
        user: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
        group: null,
        grantedByUser: { id: 'user-1', firstName: 'Admin', lastName: 'User' },
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        permission: { findMany: vi.fn().mockResolvedValue(mockPermissions) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.permissions).toHaveLength(1);
    expect(body.permissions[0].user.email).toBe('john@example.com');
  });
});

describe('POST /api/rooms/:roomId/permissions', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  const mockViewerSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'VIEWER' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue(
      mockViewerSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid grantee type', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'INVALID',
        userId: 'user-2',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('grantee type');
  });

  it('returns 400 for invalid permission level', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'SUPERADMIN',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('permission level');
  });

  it('returns 400 when USER grantee has no userId or email', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
  });

  it('returns 400 when GROUP grantee has no groupId', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'GROUP',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
  });

  it('creates new permission successfully', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const newPermission = {
      id: 'perm-new',
      granteeType: 'USER',
      userId: 'user-2',
      permissionLevel: 'VIEW',
      user: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      group: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        permission: {
          findFirst: vi.fn().mockResolvedValue(null), // No existing permission
          create: vi.fn().mockResolvedValue(newPermission),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.permission.id).toBe('perm-new');
  });

  it('updates existing permission instead of creating duplicate', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const existingPermission = {
      id: 'perm-existing',
      granteeType: 'USER',
      userId: 'user-2',
      permissionLevel: 'VIEW',
    };

    const updatedPermission = {
      ...existingPermission,
      permissionLevel: 'DOWNLOAD',
      user: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      group: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        permission: {
          findFirst: vi.fn().mockResolvedValue(existingPermission),
          update: vi.fn().mockResolvedValue(updatedPermission),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'DOWNLOAD',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(200); // Not 201, because it's an update

    const body = await response.json();
    expect(body.permission.permissionLevel).toBe('DOWNLOAD');
  });

  it('creates permission with expiration date', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const newPermission = {
      id: 'perm-new',
      granteeType: 'USER',
      userId: 'user-2',
      permissionLevel: 'VIEW',
      expiresAt: new Date(expiresAt),
      user: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      group: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        permission: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newPermission),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'VIEW',
        expiresAt,
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);
  });

  it('creates document-level permission', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const newPermission = {
      id: 'perm-new',
      granteeType: 'USER',
      userId: 'user-2',
      permissionLevel: 'VIEW',
      resourceType: 'DOCUMENT',
      documentId: 'doc-1',
      user: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      group: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        document: { findFirst: vi.fn().mockResolvedValue({ id: 'doc-1' }) },
        permission: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newPermission),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        userId: 'user-2',
        permissionLevel: 'VIEW',
        documentId: 'doc-1',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.permission.resourceType).toBe('DOCUMENT');
  });

  it('looks up user by email when userId not provided', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    const newPermission = {
      id: 'perm-new',
      granteeType: 'USER',
      userId: 'user-found',
      permissionLevel: 'VIEW',
      user: { id: 'user-found', firstName: 'Found', lastName: 'User', email: 'found@example.com' },
      group: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-found' }) },
        permission: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newPermission),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        email: 'found@example.com',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);
  });

  it('returns 404 when user email not found', async () => {
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/permissions', {
      method: 'POST',
      body: JSON.stringify({
        granteeType: 'USER',
        email: 'notfound@example.com',
        permissionLevel: 'VIEW',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(404);
  });
});
