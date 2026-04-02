/**
 * Checklists API Tests
 *
 * Validates GET (list with progress) and POST (create) for room checklists.
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
  checklist: { findMany: vi.fn(), create: vi.fn() },
  event: { create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, POST } from './route';

const mockRoom = { id: 'room-1', organizationId: 'org-1' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('GET /api/rooms/:roomId/checklists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.event.create.mockResolvedValue({});
  });

  it('returns checklists with progress stats', async () => {
    mockTx.checklist.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        name: 'Due Diligence',
        items: [
          { id: 'item-1', status: 'COMPLETE', sortOrder: 0 },
          { id: 'item-2', status: 'PENDING', sortOrder: 1 },
          { id: 'item-3', status: 'COMPLETE', sortOrder: 2 },
        ],
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checklists).toHaveLength(1);
    expect(body.checklists[0]._stats.itemsCount).toBe(3);
    expect(body.checklists[0]._stats.completedCount).toBe(2);
  });

  it('returns empty array when no checklists exist', async () => {
    mockTx.checklist.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checklists).toEqual([]);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(403);
  });
});

describe('POST /api/rooms/:roomId/checklists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.event.create.mockResolvedValue({});
  });

  it('creates checklist and returns 201', async () => {
    const created = { id: 'cl-new', name: 'Financial Review', items: [] };
    mockTx.checklist.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists', {
      method: 'POST',
      body: JSON.stringify({ name: 'Financial Review' }),
    });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.checklist.id).toBe('cl-new');
  });

  it('creates checklist with initial items', async () => {
    const created = {
      id: 'cl-new',
      name: 'Legal Review',
      items: [
        { id: 'item-1', name: 'NDA signed', sortOrder: 0 },
        { id: 'item-2', name: 'IP assignment', sortOrder: 1 },
      ],
    };
    mockTx.checklist.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Legal Review',
        items: [{ name: 'NDA signed' }, { name: 'IP assignment' }],
      }),
    });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.checklist.items).toHaveLength(2);
  });

  it('returns 400 for missing name', async () => {
    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists', {
      method: 'POST',
      body: JSON.stringify({ description: 'No name provided' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/checklists', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(403);
  });
});
