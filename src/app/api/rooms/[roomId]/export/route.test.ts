/**
 * Room Export API Tests (F113)
 *
 * Tests for room export job creation and status checking.
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
  getProviders: vi.fn(),
}));

// Mock deployment capabilities
vi.mock('@/lib/deployment-capabilities', () => ({
  hasCapability: vi.fn(),
  createCapabilityUnavailableResponse: vi.fn(),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability, createCapabilityUnavailableResponse } from '@/lib/deployment-capabilities';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);
const mockGetProviders = vi.mocked(getProviders);
const mockHasCapability = vi.mocked(hasCapability);
const mockCreateCapabilityUnavailableResponse = vi.mocked(createCapabilityUnavailableResponse);

describe('POST /api/rooms/:roomId/export', () => {
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
    mockHasCapability.mockReturnValue(true);
    mockGetProviders.mockReturnValue({
      job: {
        addJob: vi.fn().mockResolvedValue('job-123'),
      },
    } as unknown as ReturnType<typeof getProviders>);
  });

  it('returns 503 when bulk export capability unavailable', async () => {
    mockHasCapability.mockReturnValue(false);
    mockCreateCapabilityUnavailableResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Room export requires Redis queue' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(503);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(403);
  });

  it('returns 404 when room not found', async () => {
    mockWithOrgContext.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(404);
  });

  it('creates export job with default options', async () => {
    mockWithOrgContext.mockResolvedValue({ id: 'room-1', name: 'Test Room' });

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body.jobId).toBe('job-123');
    expect(body.status).toBe('pending');
  });

  it('creates export job with custom options', async () => {
    mockWithOrgContext.mockResolvedValue({ id: 'room-1' });

    const mockJobProvider = {
      addJob: vi.fn().mockResolvedValue('job-456'),
    };
    mockGetProviders.mockReturnValue({
      job: mockJobProvider,
    } as unknown as ReturnType<typeof getProviders>);

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({
        includeOriginals: true,
        includePreviews: false,
        includeMetadata: true,
        folderId: 'folder-1',
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(202);

    expect(mockJobProvider.addJob).toHaveBeenCalledWith(
      expect.any(String),
      'room.export',
      expect.objectContaining({
        roomId: 'room-1',
        options: expect.objectContaining({
          includeOriginals: true,
          includePreviews: false,
          folderId: 'folder-1',
        }),
      }),
      expect.any(Object)
    );
  });

  it('creates export job for specific documents', async () => {
    mockWithOrgContext.mockResolvedValue({ id: 'room-1' });

    const mockJobProvider = {
      addJob: vi.fn().mockResolvedValue('job-789'),
    };
    mockGetProviders.mockReturnValue({
      job: mockJobProvider,
    } as unknown as ReturnType<typeof getProviders>);

    const request = new NextRequest('http://localhost/api/rooms/room-1/export', {
      method: 'POST',
      body: JSON.stringify({
        documentIds: ['doc-1', 'doc-2', 'doc-3'],
      }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);
    expect(response.status).toBe(202);

    expect(mockJobProvider.addJob).toHaveBeenCalledWith(
      expect.any(String),
      'room.export',
      expect.objectContaining({
        options: expect.objectContaining({
          documentIds: ['doc-1', 'doc-2', 'doc-3'],
        }),
      }),
      expect.any(Object)
    );
  });
});

describe('GET /api/rooms/:roomId/export', () => {
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
    mockGetProviders.mockReturnValue({
      job: {
        getJobStatus: vi.fn().mockResolvedValue({ state: 'completed' }),
      },
    } as unknown as ReturnType<typeof getProviders>);
  });

  it('returns 500 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/rooms/room-1/export');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/export');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/export');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns job status when jobId provided', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const mockJobProvider = {
      getJobStatus: vi.fn().mockResolvedValue({ state: 'active', progress: 50 }),
    };
    mockGetProviders.mockReturnValue({
      job: mockJobProvider,
    } as unknown as ReturnType<typeof getProviders>);

    const request = new NextRequest('http://localhost/api/rooms/room-1/export?jobId=job-123');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.jobId).toBe('job-123');
    expect(body.status.state).toBe('active');
    expect(body.status.progress).toBe(50);
  });

  it('lists recent exports when no jobId', async () => {
    const mockExportEvents = [
      {
        id: 'event-1',
        eventType: 'ADMIN_EXPORT_INITIATED',
        createdAt: new Date('2024-01-15T10:00:00Z'),
      },
      {
        id: 'event-2',
        eventType: 'ADMIN_EXPORT_INITIATED',
        createdAt: new Date('2024-01-10T10:00:00Z'),
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: { findMany: vi.fn().mockResolvedValue(mockExportEvents) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/export');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.exports).toHaveLength(2);
  });
});
