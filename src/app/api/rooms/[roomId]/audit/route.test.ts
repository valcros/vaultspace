/**
 * Audit Trail API Tests (F025)
 *
 * Tests for audit event listing and export.
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

describe('GET /api/rooms/:roomId/audit', () => {
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit');
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

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns paginated audit events', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: 'Viewed Contract.pdf',
        ipAddress: '192.168.1.1',
        metadata: { documentId: 'doc-1' },
        createdAt: new Date('2024-01-15T10:30:00Z'),
        actor: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      },
      {
        id: 'event-2',
        eventType: 'DOCUMENT_DOWNLOADED',
        description: 'Downloaded Contract.pdf',
        ipAddress: '192.168.1.1',
        metadata: { documentId: 'doc-1' },
        createdAt: new Date('2024-01-15T10:35:00Z'),
        actor: { id: 'user-2', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(2),
          findMany: vi.fn().mockResolvedValue(mockEvents),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.page).toBe(1);
    expect(body.events[0].eventType).toBe('DOCUMENT_VIEWED');
    expect(body.events[0].type).toBe('DOCUMENT_VIEWED'); // Both formats
  });

  it('supports pagination parameters', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(100),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit?page=2&limit=25');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(25);
    expect(body.pagination.totalPages).toBe(4);
  });

  it('enforces maximum limit of 100', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(500),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit?limit=500');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.limit).toBe(100); // Capped at 100
  });

  it('filters by event type', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_DOWNLOADED',
        description: 'Downloaded file',
        createdAt: new Date(),
        actor: null,
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue(mockEvents),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest(
      'http://localhost/api/rooms/room-1/audit?eventType=DOCUMENT_DOWNLOADED'
    );
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe('DOCUMENT_DOWNLOADED');
  });

  it('filters by date range', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest(
      'http://localhost/api/rooms/room-1/audit?dateFrom=2024-01-01&dateTo=2024-01-31'
    );
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);
  });

  it('exports as CSV when format=csv', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: 'Viewed file',
        ipAddress: '10.0.0.1',
        createdAt: new Date('2024-01-15T10:30:00Z'),
        actor: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue(mockEvents),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit?format=csv');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Content-Disposition')).toContain('audit-room-1');

    const csv = await response.text();
    expect(csv).toContain('Timestamp,Event Type,Actor');
    expect(csv).toContain('DOCUMENT_VIEWED');
    expect(csv).toContain('John Doe');
  });

  it('handles events without actors in CSV', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'SYSTEM_MAINTENANCE',
        description: 'Scheduled maintenance',
        ipAddress: null,
        createdAt: new Date('2024-01-15T10:30:00Z'),
        actor: null,
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        event: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue(mockEvents),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/audit?format=csv');
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const csv = await response.text();
    expect(csv).toContain('System'); // System actor name for null actor
  });
});
