/**
 * Admin Activity Log API Tests (F040)
 *
 * Tests for organization-wide activity log with filtering.
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

describe('GET /api/organization/activity', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);
  });

  it('returns 500 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it('returns paginated activity events', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_UPLOADED',
        actorType: 'ADMIN',
        description: 'Uploaded file.pdf',
        ipAddress: '192.168.1.1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: { id: 'user-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
        room: { id: 'room-1', name: 'Due Diligence' },
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue({ events: mockEvents, total: 1 });

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe('DOCUMENT_UPLOADED');
    expect(body.events[0].actor.name).toBe('John Doe');
    expect(body.pagination.total).toBe(1);
  });

  it('supports pagination parameters', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 150 });

    const request = new NextRequest('http://localhost/api/organization/activity?page=3&limit=25');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.page).toBe(3);
    expect(body.pagination.limit).toBe(25);
    expect(body.pagination.totalPages).toBe(6);
  });

  it('enforces max limit of 100', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 500 });

    const request = new NextRequest('http://localhost/api/organization/activity?limit=200');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.limit).toBe(100);
  });

  it('filters by userId', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 0 });

    const request = new NextRequest('http://localhost/api/organization/activity?userId=user-2');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by eventType', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 0 });

    const request = new NextRequest('http://localhost/api/organization/activity?eventType=DOCUMENT_DOWNLOADED');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by roomId', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 0 });

    const request = new NextRequest('http://localhost/api/organization/activity?roomId=room-1');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by date range', async () => {
    mockWithOrgContext.mockResolvedValue({ events: [], total: 0 });

    const request = new NextRequest(
      'http://localhost/api/organization/activity?from=2024-01-01&to=2024-01-31'
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('exports as CSV when export=csv', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: 'Viewed document',
        ipAddress: '10.0.0.1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: { id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
        room: { id: 'room-1', name: 'Financials' },
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue({ events: mockEvents, total: 1 });

    const request = new NextRequest('http://localhost/api/organization/activity?export=csv');
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');

    const csv = await response.text();
    expect(csv).toContain('Timestamp,Event Type,Actor');
    expect(csv).toContain('DOCUMENT_VIEWED');
    expect(csv).toContain('Jane Doe');
    expect(csv).toContain('Financials');
  });

  it('handles events without actors', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'SYSTEM_BACKUP',
        description: 'Automatic backup',
        ipAddress: null,
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: null,
        room: null,
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue({ events: mockEvents, total: 1 });

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events[0].actor).toBeNull();
    expect(body.events[0].room).toBeNull();
  });

  it('handles events with email-only actors', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: 'External viewer',
        ipAddress: '1.2.3.4',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: null,
        room: { id: 'room-1', name: 'Public Room' },
        actorEmail: 'external@viewer.com',
      },
    ];

    mockWithOrgContext.mockResolvedValue({ events: mockEvents, total: 1 });

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events[0].actor.email).toBe('external@viewer.com');
  });
});
