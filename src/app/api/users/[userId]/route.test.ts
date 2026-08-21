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
  requireAuthCredential: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  clearSessionCache: vi.fn(),
  revokeAdminUserGlobalSingleOrgSessionsInTx: vi.fn(),
  revokeAdminUserOrgSessionsInTx: vi.fn(),
}));

const mockCreateSecurityAuditEvent = vi.fn();
vi.mock('@/lib/audit/securityAudit', () => ({
  createSecurityAuditEvent: (...args: unknown[]) => mockCreateSecurityAuditEvent(...args),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
  bootstrapDb: { userOrganization: { count: vi.fn(), findMany: vi.fn() } },
}));

import { requireAuth, requireAuthCredential } from '@/lib/middleware';
import {
  clearSessionCache,
  revokeAdminUserGlobalSingleOrgSessionsInTx,
  revokeAdminUserOrgSessionsInTx,
} from '@/lib/auth';
import { withOrgContext, bootstrapDb } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireAuthCredential = vi.mocked(requireAuthCredential);
const mockClearSessionCache = vi.mocked(clearSessionCache);
const mockRevokeAdminUserGlobalSingleOrgSessionsInTx = vi.mocked(
  revokeAdminUserGlobalSingleOrgSessionsInTx
);
const mockRevokeAdminUserOrgSessionsInTx = vi.mocked(revokeAdminUserOrgSessionsInTx);
const mockWithOrgContext = vi.mocked(withOrgContext);
const mockBootstrapCount = vi.mocked(bootstrapDb.userOrganization.count);
const mockBootstrapFindMany = vi.mocked(bootstrapDb.userOrganization.findMany);

describe('GET /api/users/:userId', () => {
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
    mockBootstrapFindMany.mockResolvedValue([{ organizationId: 'org-1' }] as never);
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
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
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
    user: { email: 'admin@example.com' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthCredential.mockResolvedValue({
      session: mockAdminSession,
      token: 'a'.repeat(43),
    } as Awaited<ReturnType<typeof requireAuthCredential>>);
    mockRevokeAdminUserOrgSessionsInTx.mockResolvedValue({ sessionIds: ['session-org-1'] });
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuthCredential.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/users/user-1', {
      method: 'DELETE',
    });
    const context = { params: Promise.resolve({ userId: 'user-1' }) };

    const response = await DELETE(request, context);
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuthCredential.mockResolvedValue({
      token: 'v'.repeat(43),
      session: {
        userId: 'user-1',
        organizationId: 'org-1',
        organization: { role: 'VIEWER' },
        user: { email: 'viewer@example.com' },
      },
    } as Awaited<ReturnType<typeof requireAuthCredential>>);

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
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
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

  it('archives only the current organization membership and revokes scoped access', async () => {
    const mockUserOrgUpdate = vi.fn().mockResolvedValue({});
    const mockPermissionUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockResetFindMany = vi.fn().mockResolvedValue([{ id: 'reset-org-1' }]);
    const mockResetUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockRecoveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockEventCreate = vi.fn().mockResolvedValue({});

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'uo-1',
            userId: 'user-2',
            role: 'VIEWER',
            isActive: true,
            user: { id: 'user-2', email: 'user@example.com', isActive: true },
          }),
          count: vi.fn().mockResolvedValue(2),
          update: mockUserOrgUpdate,
        },
        passwordResetToken: {
          findMany: mockResetFindMany,
          updateMany: mockResetUpdateMany,
        },
        passwordResetRecovery: { updateMany: mockRecoveryUpdateMany },
        permission: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'permission-1', roomId: 'room-1', resourceType: 'ROOM', permissionLevel: 'VIEW' },
            {
              id: 'permission-2',
              roomId: null,
              resourceType: 'ORGANIZATION',
              permissionLevel: 'VIEW',
            },
          ]),
          updateMany: mockPermissionUpdateMany,
        },
        event: { create: mockEventCreate },
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
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
    expect(body.message).toContain('archived from this organization');

    // The identity is not mutated. Only this organization membership changes.
    expect(mockUserOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'uo-1' },
      data: expect.objectContaining({
        isActive: false,
        archivedByUserId: 'admin-1',
        archivedAt: expect.any(Date),
      }),
    });
    expect(mockPermissionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['permission-1', 'permission-2'] } },
      data: { isActive: false },
    });
    expect(mockResetUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reset-org-1'] } },
      data: { usedAt: expect.any(Date), deliveryStatus: 'CANCELLED' },
    });
    expect(mockRecoveryUpdateMany).toHaveBeenCalledWith({
      where: { flowId: { in: ['reset-org-1'] }, wipedAt: null },
      data: expect.objectContaining({
        wipedAt: expect.any(Date),
        enqueueStatus: 'MEMBERSHIP_ARCHIVED',
      }),
    });
    expect(mockRevokeAdminUserOrgSessionsInTx).toHaveBeenCalledWith(
      expect.any(Object),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-org-1']);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'USER_DELETED' }),
      })
    );
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
    sessionId: 'admin-session-1',
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
    mockRequireAuthCredential.mockResolvedValue({
      session: mockAdminSession,
      token: 'a'.repeat(43),
    } as Awaited<ReturnType<typeof requireAuthCredential>>);
    mockClearSessionCache.mockResolvedValue(undefined);
    mockRevokeAdminUserGlobalSingleOrgSessionsInTx.mockResolvedValue({
      sessionIds: ['session-global-1'],
    });
    mockRevokeAdminUserOrgSessionsInTx.mockResolvedValue({
      sessionIds: ['session-org-1'],
    });
    mockBootstrapCount.mockResolvedValue(1);
    mockBootstrapFindMany.mockResolvedValue([{ organizationId: 'org-1' }] as never);
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
          user: {
            id: 'user-2',
            email: 'user@example.com',
            firstName: 'Existing',
            lastName: 'User',
            title: null,
            isActive: true,
          },
          ...overrides,
        }),
        count: vi.fn().mockResolvedValue(3),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      event: { create: vi.fn().mockResolvedValue({}) },
      passwordResetToken: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetRecovery: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
  }

  const patchReq = (payload: unknown) =>
    new NextRequest('http://localhost/api/users/user-2', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  const ctx = { params: Promise.resolve({ userId: 'user-2' }) };

  it('returns 403 for non-admin callers', async () => {
    mockRequireAuthCredential.mockResolvedValue({
      token: 'v'.repeat(43),
      session: {
        userId: 'viewer-1',
        organizationId: 'org-1',
        organization: { role: 'VIEWER' },
        user: { email: 'viewer@example.com' },
      },
    } as Awaited<ReturnType<typeof requireAuthCredential>>);

    const response = await PATCH(patchReq({ firstName: 'X' }), ctx);
    expect(response.status).toBe(403);
  });

  it('returns 404 when the target is not a member of the org', async () => {
    useTx({
      userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    });
    const response = await PATCH(patchReq({ firstName: 'X' }), ctx);
    expect(response.status).toBe(404);
  });

  it('blocks demoting the last active admin (400) and does not clear sessions', async () => {
    const tx = memberTx({ role: 'ADMIN', isActive: true });
    tx.userOrganization.count = vi.fn().mockResolvedValue(1);
    useTx(tx);
    const response = await PATCH(patchReq({ role: 'VIEWER' }), ctx);
    expect(response.status).toBe(400);
    expect(mockRevokeAdminUserOrgSessionsInTx).not.toHaveBeenCalled();
  });

  it('scopes session invalidation to this org on a role change (leaves other orgs signed in)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ role: 'ADMIN' }), ctx);
    expect(response.status).toBe(200);
    // Membership-only change -> org-scoped invalidation, NOT the global one.
    expect(mockRevokeAdminUserOrgSessionsInTx).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).not.toHaveBeenCalled();
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-org-1']);
  });

  it('scopes session invalidation to this org on a membership active change', async () => {
    useTx(memberTx({ isActive: true }));
    const response = await PATCH(patchReq({ isActive: false }), ctx);
    expect(response.status).toBe(200);
    expect(mockRevokeAdminUserOrgSessionsInTx).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).not.toHaveBeenCalled();
  });

  it('does not commit a membership change when SQL cannot prove admin scope', async () => {
    const tx = memberTx();
    mockRevokeAdminUserOrgSessionsInTx.mockResolvedValue(null);
    useTx(tx);

    const response = await PATCH(patchReq({ role: 'ADMIN' }), ctx);

    expect(response.status).toBe(404);
    expect(tx.userOrganization.update).not.toHaveBeenCalled();
    expect(mockClearSessionCache).not.toHaveBeenCalled();
  });

  it('invalidates ALL sessions on a login-email change (global identity)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ email: 'moved@example.com' }), ctx);
    expect(response.status).toBe(200);
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockRevokeAdminUserOrgSessionsInTx).not.toHaveBeenCalled();
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-global-1']);
  });

  it('invalidates ALL sessions on a two-factor reset (global identity)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ resetTwoFactor: true }), ctx);
    expect(response.status).toBe(200);
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockRevokeAdminUserOrgSessionsInTx).not.toHaveBeenCalled();
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-global-1']);
  });

  it('a global identity change takes precedence over a membership change (email + role -> global)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ email: 'moved@example.com', role: 'ADMIN' }), ctx);
    expect(response.status).toBe(200);
    // Even though role also changed, the email change forces GLOBAL invalidation
    // and the org-scoped helper must not be used (it would leave other-org
    // sessions on the old login identity alive).
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(43),
      'user-2'
    );
    expect(mockRevokeAdminUserOrgSessionsInTx).not.toHaveBeenCalled();
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-global-1']);
  });

  it('does not invalidate sessions on a name-only change', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ firstName: 'Newname' }), ctx);
    expect(response.status).toBe(200);
    expect(mockRevokeAdminUserGlobalSingleOrgSessionsInTx).not.toHaveBeenCalled();
    expect(mockRevokeAdminUserOrgSessionsInTx).not.toHaveBeenCalled();
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

  it('rejects an email change for a user in multiple organizations (403)', async () => {
    mockRevokeAdminUserGlobalSingleOrgSessionsInTx.mockResolvedValue(null);
    useTx(memberTx());
    const response = await PATCH(patchReq({ email: 'attacker@example.com' }), ctx);
    expect(response.status).toBe(403);
  });

  it('invalidates outstanding reset tokens when the login email changes', async () => {
    const tx = memberTx();
    tx.passwordResetToken.findMany.mockResolvedValue([{ id: 'reset-1', requestId: 'request-1' }]);
    useTx(tx);
    const response = await PATCH(patchReq({ email: 'moved@example.com' }), ctx);
    expect(response.status).toBe(200);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reset-1'] } },
      data: { usedAt: expect.any(Date), deliveryStatus: 'CANCELLED' },
    });
    expect(tx.passwordResetRecovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { flowId: { in: ['reset-1'] }, wipedAt: null },
        data: expect.objectContaining({ enqueueStatus: 'EMAIL_CHANGED', ciphertext: null }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ correlationId: 'reset-1' })
    );
  });

  it('audits email-change reset cancellation in every account organization', async () => {
    mockBootstrapFindMany.mockResolvedValue([
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ] as never);
    const tx = memberTx();
    tx.passwordResetToken.findMany.mockResolvedValue([
      { id: 'reset-other-org', requestId: 'request-other-org' },
    ]);
    useTx(tx);

    const response = await PATCH(patchReq({ email: 'moved@example.com' }), ctx);

    expect(response.status).toBe(200);
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-2',
        requestId: 'request-other-org',
        correlationId: 'reset-other-org',
        idempotencyKey: 'password-reset-reset-other-org-email_changed-org-2',
        metadata: expect.objectContaining({
          errorCode: 'EMAIL_CHANGED',
          initiatingOrganizationId: 'org-1',
        }),
      })
    );
  });

  it('cancels account-global reset flows when the final active membership is deactivated', async () => {
    mockBootstrapCount.mockResolvedValue(1);
    mockBootstrapFindMany.mockResolvedValue([
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ] as never);
    const tx = memberTx({ isActive: true });
    tx.passwordResetToken.findMany.mockResolvedValue([
      { id: 'reset-global', requestId: 'request-global' },
    ]);
    useTx(tx);

    const response = await PATCH(patchReq({ isActive: false }), ctx);

    expect(response.status).toBe(200);
    expect(tx.passwordResetToken.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', usedAt: null },
      select: { id: true, requestId: true },
    });
    expect(tx.passwordResetRecovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enqueueStatus: 'MEMBERSHIP_DEACTIVATED',
          ciphertext: null,
        }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-2',
        idempotencyKey: 'password-reset-reset-global-membership_deactivated-org-2',
      })
    );
  });

  it('preserves account-global reset flows when another active membership remains', async () => {
    mockBootstrapCount.mockResolvedValue(2);
    const tx = memberTx({ isActive: true });
    useTx(tx);

    const response = await PATCH(patchReq({ isActive: false }), ctx);

    expect(response.status).toBe(200);
    expect(tx.passwordResetToken.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', organizationId: 'org-1', usedAt: null },
      select: { id: true, requestId: true },
    });
  });

  it('does not touch reset tokens when the email is unchanged', async () => {
    const tx = memberTx();
    useTx(tx);
    const response = await PATCH(patchReq({ firstName: 'Newname' }), ctx);
    expect(response.status).toBe(200);
    expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a non-string title (400)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ title: 42 }), ctx);
    expect(response.status).toBe(400);
  });

  it('rejects an overlong first name (400)', async () => {
    useTx(memberTx());
    const response = await PATCH(patchReq({ firstName: 'a'.repeat(101) }), ctx);
    expect(response.status).toBe(400);
  });

  it('allows demoting an admin whose global account is already inactive', async () => {
    const tx = memberTx({
      role: 'ADMIN',
      isActive: true,
      user: {
        id: 'user-2',
        email: 'user@example.com',
        firstName: 'Existing',
        lastName: 'User',
        title: null,
        isActive: false,
      },
    });
    // Only one usable admin remains, but the target is not counted, so the
    // last-admin guard must not fire.
    tx.userOrganization.count = vi.fn().mockResolvedValue(1);
    useTx(tx);
    const response = await PATCH(patchReq({ role: 'VIEWER' }), ctx);
    expect(response.status).toBe(200);
  });
});
