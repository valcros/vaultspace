/**
 * Team Member Invite API Tests (F044)
 *
 * Tests for invitation creation and listing.
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

// Mock providers
vi.mock('@/providers', () => ({
  getProviders: vi.fn().mockReturnValue({
    email: {
      send: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

// Mock notification service
vi.mock('@/services/notifications', () => ({
  EmailNotificationService: vi.fn().mockImplementation(() => ({
    sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('POST /api/users/invite', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
    user: { email: 'admin@example.com' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
    process.env['APP_URL'] = 'https://example.com';
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 when email is missing', async () => {
    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Email');
  });

  it('returns 400 for invalid email format', async () => {
    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('email format');
  });

  it('returns 400 for invalid role', async () => {
    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', role: 'SUPERADMIN' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('role');
  });

  it('returns 400 when user already in organization', async () => {
    const userFindUnique = vi.fn().mockResolvedValue({
      id: 'user-exists',
      email: 'existing@example.com',
      organizations: [{ organizationId: 'org-1' }],
    });
    mockWithOrgContext.mockImplementation(async (orgId, callback) => {
      expect(orgId).toBe('org-1');
      return callback({ user: { findUnique: userFindUnique } } as unknown as Parameters<
        typeof callback
      >[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'existing@example.com', role: 'ADMIN' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('already a member');
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: 'existing@example.com' },
      include: { organizations: { where: { organizationId: 'org-1' } } },
    });
  });

  it('returns 400 when pending invitation exists', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        invitation: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'invite-pending', role: 'ADMIN', roomAssignments: [] }]),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'pending@example.com', role: 'ADMIN' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('pending');
  });

  it('creates invitation successfully with default VIEWER role', async () => {
    const createAssignments = vi.fn().mockResolvedValue({ count: 1 });
    const mockInvitation = {
      id: 'invite-1',
      email: 'new@example.com',
      role: 'VIEWER',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitationUrl: 'https://example.com/auth/register?token=abc123',
      invitedByUser: { firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findMany: vi.fn().mockResolvedValue([{ id: 'room-1' }]) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        invitation: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue(mockInvitation),
        },
        invitationRoomAssignment: { createMany: createAssignments },
        event: { create: vi.fn().mockResolvedValue({}) },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', roomIds: ['room-1'] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.invitation.email).toBe('new@example.com');
    expect(body.invitation.role).toBe('VIEWER');
    expect(body.invitation.status).toBe('PENDING');
    expect(body.invitation.roomCount).toBe(1);
    expect(createAssignments).toHaveBeenCalledWith({
      data: [{ invitationId: 'invite-1', roomId: 'room-1' }],
    });
  });

  it('creates invitation with ADMIN role', async () => {
    const mockInvitation = {
      id: 'invite-1',
      email: 'admin-invite@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: new Date(),
      invitationUrl: 'https://example.com/auth/register?token=xyz',
      invitedByUser: { firstName: 'Super', lastName: 'Admin', email: 'super@example.com' },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        invitation: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue(mockInvitation),
        },
        event: { create: vi.fn().mockResolvedValue({}) },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin-invite@example.com', role: 'ADMIN' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.invitation.role).toBe('ADMIN');
  });

  it('rejects a viewer invitation without room assignments', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = { room: { findMany: vi.fn().mockResolvedValue([]) } };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer@example.com' }),
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least one active room/i);
    expect(mockWithOrgContext).toHaveBeenCalledOnce();
  });

  it('automatically assigns the only active room to a viewer invitation', async () => {
    const createAssignments = vi.fn().mockResolvedValue({ count: 1 });
    const invitationCreate = vi.fn().mockResolvedValue({
      id: 'invite-single-room',
      email: 'viewer@example.com',
      role: 'VIEWER',
      status: 'PENDING',
      expiresAt: new Date('2026-08-28T00:00:00Z'),
      invitationUrl: 'https://example.com/auth/register?token=single-room',
      invitedByUser: { firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
    });
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findMany: vi.fn().mockResolvedValue([{ id: 'only-room' }]) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        invitation: { findMany: vi.fn().mockResolvedValue([]), create: invitationCreate },
        invitationRoomAssignment: { createMany: createAssignments },
        event: { create: vi.fn().mockResolvedValue({}) },
        organization: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer@example.com' }),
      })
    );

    expect(response.status).toBe(201);
    expect(createAssignments).toHaveBeenCalledWith({
      data: [{ invitationId: 'invite-single-room', roomId: 'only-room' }],
    });
    await expect(response.json()).resolves.toMatchObject({ invitation: { roomCount: 1 } });
  });

  it('rejects a room that is not active in the inviting organization', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = { room: { findMany: vi.fn().mockResolvedValue([]) } };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer@example.com', roomIds: ['foreign-room'] }),
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/belong to this organization/i);
  });

  it('reissues a legacy viewer invitation by rejecting the unscoped pending row', async () => {
    const rejectLegacyInvite = vi.fn().mockResolvedValue({ count: 1 });
    const createAssignments = vi.fn().mockResolvedValue({ count: 1 });
    const mockInvitation = {
      id: 'new-invite-1',
      email: 'viewer@example.com',
      role: 'VIEWER',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitationUrl: 'https://example.com/auth/register?token=new-token',
      invitedByUser: { firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findMany: vi.fn().mockResolvedValue([{ id: 'room-1' }]) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        invitation: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'legacy-invite', role: 'VIEWER', roomAssignments: [] }]),
          updateMany: rejectLegacyInvite,
          create: vi.fn().mockResolvedValue(mockInvitation),
        },
        invitationRoomAssignment: { createMany: createAssignments },
        event: { create: vi.fn().mockResolvedValue({}) },
        organization: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer@example.com', roomIds: ['room-1'] }),
      })
    );

    expect(response.status).toBe(201);
    expect(rejectLegacyInvite).toHaveBeenCalledWith({
      where: { id: { in: ['legacy-invite'] }, status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
    expect(createAssignments).toHaveBeenCalledWith({
      data: [{ invitationId: 'new-invite-1', roomId: 'room-1' }],
    });
  });
});

describe('GET /api/users/invite', () => {
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

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns list of invitations', async () => {
    const mockInvitations = [
      {
        id: 'invite-1',
        email: 'invited1@example.com',
        role: 'VIEWER',
        status: 'PENDING',
        createdAt: new Date('2024-01-10'),
        expiresAt: new Date('2024-01-17'),
        acceptedAt: null,
        invitedByUser: { firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
      },
      {
        id: 'invite-2',
        email: 'invited2@example.com',
        role: 'ADMIN',
        status: 'ACCEPTED',
        createdAt: new Date('2024-01-05'),
        expiresAt: new Date('2024-01-12'),
        acceptedAt: new Date('2024-01-06'),
        invitedByUser: { firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
      },
    ];

    mockWithOrgContext.mockResolvedValue(mockInvitations);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.invitations).toHaveLength(2);
    expect(body.invitations[0].status).toBe('PENDING');
    expect(body.invitations[1].status).toBe('ACCEPTED');
  });

  it('returns empty list when no invitations', async () => {
    mockWithOrgContext.mockResolvedValue([]);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.invitations).toEqual([]);
  });
});
