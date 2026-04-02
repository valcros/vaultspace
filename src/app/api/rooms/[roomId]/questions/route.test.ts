/**
 * Questions API Tests
 *
 * Validates GET (list) and POST (create) for room questions.
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
  question: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  document: { findFirst: vi.fn() },
  event: { create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, POST } from './route';
import { requireAuth } from '@/lib/middleware';

const mockRoom = { id: 'room-1', organizationId: 'org-1' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('GET /api/rooms/:roomId/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.event.create.mockResolvedValue({});
  });

  it('returns questions list', async () => {
    const questions = [
      { id: 'q-1', subject: 'Question 1', _count: { answers: 0 } },
      { id: 'q-2', subject: 'Question 2', _count: { answers: 1 } },
    ];
    mockTx.question.count.mockResolvedValue(2);
    mockTx.question.findMany.mockResolvedValue(questions);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questions).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by status query param', async () => {
    mockTx.question.count.mockResolvedValue(0);
    mockTx.question.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions?status=OPEN');
    await GET(req, makeContext());

    const whereArg = mockTx.question.findMany.mock.calls[0]![0].where;
    expect(whereArg.status).toBe('OPEN');
  });

  it('returns empty array for no questions', async () => {
    mockTx.question.count.mockResolvedValue(0);
    mockTx.question.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questions).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(403);
  });
});

describe('POST /api/rooms/:roomId/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.event.create.mockResolvedValue({});
  });

  it('creates question and returns 201', async () => {
    const created = { id: 'q-new', subject: 'New question', body: 'Details here' };
    mockTx.question.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions', {
      method: 'POST',
      body: JSON.stringify({ subject: 'New question', body: 'Details here' }),
    });
    const res = await POST(req, makeContext());
    const responseBody = await res.json();

    expect(res.status).toBe(201);
    expect(responseBody.question.id).toBe('q-new');
  });

  it('returns 400 for missing subject', async () => {
    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions', {
      method: 'POST',
      body: JSON.stringify({ body: 'Details but no subject' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing body', async () => {
    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions', {
      method: 'POST',
      body: JSON.stringify({ subject: 'Subject but no body' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions', {
      method: 'POST',
      body: JSON.stringify({ subject: 'Test', body: 'Test body' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(403);
  });
});
