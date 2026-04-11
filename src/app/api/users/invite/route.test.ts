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
  db: {
    user: { findUnique: vi.fn() },
  },
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
import { db, withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);
const mockDbUser = vi.mocked(db.user);

describe('POST /api/users/invite', () => {
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
    mockDbUser.findUnique.mockResolvedValue({
      id: 'user-exists',
      email: 'existing@example.com',
      organizations: [{ organizationId: 'org-1' }],
    } as unknown as Awaited<ReturnType<typeof mockDbUser.findUnique>>);

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'existing@example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('already a member');
  });

  it('returns 400 when pending invitation exists', async () => {
    mockDbUser.findUnique.mockResolvedValue(null);
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        invitation: {
          findFirst: vi.fn().mockResolvedValue({ id: 'invite-pending' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'pending@example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('pending');
  });

  it('creates invitation successfully with default VIEWER role', async () => {
    mockDbUser.findUnique.mockResolvedValue(null);

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
        invitation: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(mockInvitation),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.invitation.email).toBe('new@example.com');
    expect(body.invitation.role).toBe('VIEWER');
    expect(body.invitation.status).toBe('PENDING');
  });

  it('creates invitation with ADMIN role', async () => {
    mockDbUser.findUnique.mockResolvedValue(null);

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
        invitation: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(mockInvitation),
        },
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
