/**
 * User Management API Tests (F052)
 *
 * Tests for user details and GDPR-compliant user deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, DELETE } from './route';

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

describe('GET /api/users/:userId', () => {
  const mockAdminSession = {
    userId: 'admin-1',
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

    const request = new NextRequest('http://localhost/api/users/user-1');
    const context = { params: Promise.resolve({ userId: 'user-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(500);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/users/user-2');
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Admin');
  });

  it('returns 404 when user not in organization', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-not-found');
    const context = { params: Promise.resolve({ userId: 'user-not-found' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  it('returns user details successfully', async () => {
    const mockUserOrg = {
      role: 'VIEWER',
      isActive: true,
      user: {
        id: 'user-2',
        email: 'user@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        createdAt: new Date('2024-01-10'),
        lastLoginAt: new Date('2024-01-15'),
        isActive: true,
      },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(mockUserOrg) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-2');
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.id).toBe('user-2');
    expect(body.user.email).toBe('user@example.com');
    expect(body.user.firstName).toBe('Jane');
    expect(body.user.lastName).toBe('Doe');
    expect(body.user.role).toBe('VIEWER');
    expect(body.user.isActive).toBe(true);
  });

  it('returns isActive as false when user is deactivated', async () => {
    const mockUserOrg = {
      role: 'VIEWER',
      isActive: true,
      user: {
        id: 'user-2',
        email: 'user@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        createdAt: new Date('2024-01-10'),
        lastLoginAt: new Date('2024-01-15'),
        isActive: false,
      },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(mockUserOrg) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-2');
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.isActive).toBe(false);
  });

  it('returns isActive as false when membership is deactivated', async () => {
    const mockUserOrg = {
      role: 'VIEWER',
      isActive: false,
      user: {
        id: 'user-2',
        email: 'user@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        createdAt: new Date('2024-01-10'),
        lastLoginAt: new Date('2024-01-15'),
        isActive: true,
      },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(mockUserOrg) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-2');
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.isActive).toBe(false);
  });
});

describe('DELETE /api/users/:userId', () => {
  const mockAdminSession = {
    userId: 'admin-1',
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

    const request = new NextRequest('http://localhost/api/users/user-1', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-1' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(500);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/users/user-2', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Admin');
  });

  it('returns 400 when trying to delete own account', async () => {
    const request = new NextRequest('http://localhost/api/users/admin-1', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'admin-1' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('own account');
  });

  it('returns 404 when user not in organization', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-not-found', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-not-found' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  it('deletes user and redacts data per GDPR requirements', async () => {
    const mockUserUpdate = vi.fn().mockResolvedValue({});
    const mockUserOrgUpdate = vi.fn().mockResolvedValue({});
    const mockEventUpdateMany = vi.fn().mockResolvedValue({ count: 5 });
    const mockDocVersionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const mockPermissionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockRoleDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockSessionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'uo-1',
            userId: 'user-2',
            user: { id: 'user-2', email: 'user@example.com' },
          }),
          update: mockUserOrgUpdate,
        },
        user: { update: mockUserUpdate },
        event: { updateMany: mockEventUpdateMany },
        documentVersion: { updateMany: mockDocVersionUpdateMany },
        permission: { deleteMany: mockPermissionDeleteMany },
        roleAssignment: { deleteMany: mockRoleDeleteMany },
        session: { deleteMany: mockSessionDeleteMany },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/user-2', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('GDPR');

    // Verify user was soft deleted with PII redacted
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: {
        isActive: false,
        firstName: 'Deleted',
        lastName: 'User',
      },
    });

    // Verify membership was deactivated
    expect(mockUserOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'uo-1' },
      data: { isActive: false },
    });

    // Verify events were redacted
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        actorId: 'user-2',
      },
      data: {
        actorId: null,
        actorEmail: 'deleted_user@redacted',
      },
    });

    // Verify document versions were redacted
    expect(mockDocVersionUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        uploadedByUserId: 'user-2',
      },
      data: {
        uploadedByUserId: null,
        uploadedByEmail: 'deleted_user@redacted',
      },
    });

    // Verify permissions were deleted
    expect(mockPermissionDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        granteeType: 'USER',
        userId: 'user-2',
      },
    });

    // Verify role assignments were deleted
    expect(mockRoleDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userId: 'user-2',
      },
    });

    // Verify sessions were invalidated
    expect(mockSessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
    });
  });

  it('returns 500 when database error occurs', async () => {
    mockWithOrgContext.mockRejectedValue(new Error('Database error'));

    const request = new NextRequest('http://localhost/api/users/user-2', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-2' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Failed to delete');
  });
});
