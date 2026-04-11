/**
 * Room Admins API Tests (F039)
 *
 * Tests for multi-admin support - adding and listing room admins.
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

describe('GET /api/rooms/:roomId/admins', () => {
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns combined org and room admins', async () => {
    const mockRoomAdmins = [
      {
        user: { id: 'user-2', firstName: 'Room', lastName: 'Admin', email: 'room@example.com' },
      },
    ];

    const mockOrgAdmins = [
      {
        user: { id: 'user-1', firstName: 'Org', lastName: 'Admin', email: 'org@example.com' },
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        roleAssignment: { findMany: vi.fn().mockResolvedValue(mockRoomAdmins) },
        userOrganization: { findMany: vi.fn().mockResolvedValue(mockOrgAdmins) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.admins).toHaveLength(2);
    expect(body.admins.some((a: { scope: string }) => a.scope === 'organization')).toBe(true);
    expect(body.admins.some((a: { scope: string }) => a.scope === 'room')).toBe(true);
  });

  it('deduplicates admins who are both org and room admin', async () => {
    const sharedUser = {
      id: 'user-1',
      firstName: 'Both',
      lastName: 'Admin',
      email: 'both@example.com',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        roleAssignment: { findMany: vi.fn().mockResolvedValue([{ user: sharedUser }]) },
        userOrganization: { findMany: vi.fn().mockResolvedValue([{ user: sharedUser }]) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.admins).toHaveLength(1); // Deduplicated
    expect(body.admins[0].scope).toBe('organization'); // Org scope takes precedence
  });
});

describe('POST /api/rooms/:roomId/admins', () => {
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-2' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(403);
  });

  it('returns 400 when no userId or email provided', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('required');
  });

  it('returns 404 when user email not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ email: 'notfound@example.com' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(404);
  });

  it('returns 400 when user not in organization', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-external' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not a member');
  });

  it('returns 400 when user already admin', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ userId: 'user-2' }) },
        roleAssignment: { findFirst: vi.fn().mockResolvedValue({ id: 'existing-role' }) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-2' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('already an admin');
  });

  it('adds admin by userId successfully', async () => {
    const newAdmin = {
      user: { id: 'user-2', firstName: 'New', lastName: 'Admin', email: 'new@example.com' },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ userId: 'user-2' }) },
        roleAssignment: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newAdmin),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-2' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.admin.email).toBe('new@example.com');
    expect(body.admin.scope).toBe('room');
  });

  it('adds admin by email successfully', async () => {
    const foundUser = { id: 'user-found' };
    const newAdmin = {
      user: { id: 'user-found', firstName: 'Found', lastName: 'User', email: 'found@example.com' },
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue(foundUser) },
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ userId: 'user-found' }) },
        roleAssignment: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newAdmin),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/admins', {
      method: 'POST',
      body: JSON.stringify({ email: 'found@example.com' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(201);
  });
});
