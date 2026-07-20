/**
 * User Management API Tests (F052)
 *
 * Tests for user details and GDPR-compliant user deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, DELETE, PATCH } from './route';

// Mock auth middleware
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  clearSessionCache: vi.fn(),
  deactivateAllUserSessionsInTx: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

import { requireAuth } from '@/lib/middleware';
import { clearSessionCache, deactivateAllUserSessionsInTx } from '@/lib/auth';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockClearSessionCache = vi.mocked(clearSessionCache);
const mockDeactivateAllUserSessionsInTx = vi.mocked(deactivateAllUserSessionsInTx);
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
    mockClearSessionCache.mockResolvedValue(undefined);
    mockDeactivateAllUserSessionsInTx.mockResolvedValue(['token-1']);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/users/user-1');
    const context = { params: Promise.resolve({ userId: 'user-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(401);
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

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/users/user-1', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-1' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(401);
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

  it('deletes user, preserves immutable audit events, and redacts mutable data', async () => {
    const mockUserUpdate = vi.fn().mockResolvedValue({});
    const mockUserOrgUpdate = vi.fn().mockResolvedValue({});
    const mockDocVersionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const mockPermissionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockRoleDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

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
        documentVersion: { updateMany: mockDocVersionUpdateMany },
        permission: { deleteMany: mockPermissionDeleteMany },
        roleAssignment: { deleteMany: mockRoleDeleteMany },
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

    // Verify sessions were invalidated atomically and cache was cleared after commit
    expect(mockDeactivateAllUserSessionsInTx).toHaveBeenCalledWith(expect.any(Object), 'user-2');
    expect(mockClearSessionCache).toHaveBeenCalledWith(['token-1']);
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

describe('PATCH /api/users/:userId', () => {
  const mockAdminSession = {
    userId: 'admin-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
    user: { email: 'admin@example.com' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
    mockClearSessionCache.mockResolvedValue(undefined);
    mockDeactivateAllUserSessionsInTx.mockResolvedValue(['token-1']);
  });

  function useTx(tx: Record<string, unknown>) {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
      callback(tx as unknown as Parameters<typeof callback>[0])
    );
  }

  function memberTx(overrides: Record<string, unknown> = {}) {
    return {
      userOrganization: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'uo-2',
          userId: 'user-2',
          organizationId: 'org-1',
          role: 'VIEWER',
          isActive: true,
          user: { id: 'user-2', email: 'user@example.com' },
          ...overrides,
        }),
        count: vi.fn().mockResolvedValue(3),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      event: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  const patchReq = (payload: unknown) =>
    new NextRequest('http://localhost/api/users/user-2', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  const ctx = { params: Promise.resolve({ userId: 'user-2' }) };

  it('returns 403 for non-admin callers', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
      user: { email: 'viewer@example.com' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const response = await PATCH(patchReq({ firstName: 'X' }), ctx);
    expect(response.status).toBe(403);
  });

  it('returns 404 when the target is not a member of the org', async () => {
    useTx({ userOrganization: { findFirst: vi.fn().mockResolvedValue(null) } });
    const response = await PATCH(patchReq({ firstName: 'X' }), ctx);
    expect(response.status).toBe(404);
  });

  it('blocks demoting the last active admin (400) and does not clear sessions', async () => {
    const tx = memberTx({ role: 'ADMIN', isActive: true });
    tx.userOrganization.count = vi.fn().mockResolvedValue(1);
    useTx(tx);
    const response = await PATCH(patchReq({ role: 'VIEWER' }), ctx);
    expect(response.status).toBe(400);
    expect(mockDeactivateAllUserSessionsInTx).not.toHaveBeenCalled();
  });

  it('invalidates sessions on a role change', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ role: 'ADMIN' }), ctx);
    expect(response.status).toBe(200);
    expect(mockDeactivateAllUserSessionsInTx).toHaveBeenCalledWith(expect.anything(), 'user-2');
    expect(mockClearSessionCache).toHaveBeenCalled();
  });

  it('does not invalidate sessions on a name-only change', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ firstName: 'Newname' }), ctx);
    expect(response.status).toBe(200);
    expect(mockDeactivateAllUserSessionsInTx).not.toHaveBeenCalled();
  });

  it('returns 409 on a duplicate email', async () => {
    const { Prisma } = await import('@prisma/client');
    const tx = memberTx();
    tx.user.update = vi
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' })
      );
    useTx(tx);
    const response = await PATCH(patchReq({ email: 'taken@example.com' }), ctx);
    expect(response.status).toBe(409);
  });
});
