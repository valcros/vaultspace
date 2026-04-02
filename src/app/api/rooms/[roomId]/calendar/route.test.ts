/**
 * Calendar Events API Tests
 *
 * Validates GET (list) and POST (create) for room calendar events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction
const mockTx = {
  room: { findFirst: vi.fn() },
  calendarEvent: { findMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, POST } from './route';

const mockRoom = { id: 'room-1', organizationId: 'org-1' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('GET /api/rooms/:roomId/calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
  });

  it('returns events list', async () => {
    const events = [
      { id: 'ev-1', title: 'Milestone 1', date: '2026-04-10' },
      { id: 'ev-2', title: 'Deadline', date: '2026-04-15' },
    ];
    mockTx.calendarEvent.findMany.mockResolvedValue(events);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/calendar');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(2);
  });

  it('applies date range filters', async () => {
    mockTx.calendarEvent.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      'http://localhost:3000/api/rooms/room-1/calendar?from=2026-04-01&to=2026-04-30'
    );
    await GET(req, makeContext());

    const whereArg = mockTx.calendarEvent.findMany.mock.calls[0]![0].where;
    expect(whereArg.date).toBeDefined();
    expect(whereArg.date.gte).toEqual(new Date('2026-04-01'));
    expect(whereArg.date.lte).toEqual(new Date('2026-04-30'));
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/calendar');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(403);
  });
});

describe('POST /api/rooms/:roomId/calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
  });

  it('creates event and returns 201', async () => {
    const created = { id: 'ev-new', title: 'New Event', date: '2026-05-01' };
    mockTx.calendarEvent.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/calendar', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Event', date: '2026-05-01' }),
    });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.event.id).toBe('ev-new');
  });

  it('returns 400 for missing title', async () => {
    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/calendar', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-05-01' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/calendar', {
      method: 'POST',
      body: JSON.stringify({ title: 'Event', date: '2026-05-01' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(403);
  });
});
