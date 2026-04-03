/**
 * Trash Management API Tests (F114)
 *
 * Tests for soft-deleted document listing and management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

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

describe('GET /api/rooms/:roomId/trash', () => {
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns empty list when no deleted documents', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        organization: { findUnique: vi.fn().mockResolvedValue({ trashRetentionDays: 30 }) },
        document: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.documents).toEqual([]);
    expect(body.retentionDays).toBe(30);
  });

  it('returns deleted documents with deletion dates', async () => {
    const deletedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const mockDeletedDocs = [
      {
        id: 'doc-1',
        name: 'Deleted Contract.pdf',
        status: 'DELETED',
        deletedAt,
        folder: { id: 'folder-1', name: 'Contracts', path: '/Contracts' },
        versions: [
          {
            versionNumber: 1,
            uploadedByUser: { firstName: 'John', lastName: 'Doe' },
          },
        ],
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        organization: { findUnique: vi.fn().mockResolvedValue({ trashRetentionDays: 30 }) },
        document: { findMany: vi.fn().mockResolvedValue(mockDeletedDocs) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].name).toBe('Deleted Contract.pdf');
    expect(body.documents[0].daysUntilPermanentDeletion).toBe(23); // 30 - 7 = 23 days remaining
    expect(body.retentionDays).toBe(30);
  });

  it('uses default retention when org setting is null', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        organization: { findUnique: vi.fn().mockResolvedValue({ trashRetentionDays: null }) },
        document: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.retentionDays).toBe(30); // Default
  });

  it('shows 0 days remaining for documents past retention', async () => {
    const deletedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

    const mockDeletedDocs = [
      {
        id: 'doc-1',
        name: 'Old Document.pdf',
        status: 'DELETED',
        deletedAt,
        folder: null,
        versions: [],
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        organization: { findUnique: vi.fn().mockResolvedValue({ trashRetentionDays: 30 }) },
        document: { findMany: vi.fn().mockResolvedValue(mockDeletedDocs) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/trash');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.documents[0].daysUntilPermanentDeletion).toBe(0); // Can't go negative
  });
});
