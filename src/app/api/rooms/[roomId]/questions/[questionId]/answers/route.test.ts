/**
 * Answers API Tests
 *
 * Validates POST handler for creating answers to questions.
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
  question: { findFirst: vi.fn(), update: vi.fn() },
  answer: { create: vi.fn() },
  event: { create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { POST } from './route';

const mockRoom = { id: 'room-1', organizationId: 'org-1' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', questionId: 'q-1' }) };
}

describe('POST /api/rooms/:roomId/questions/:questionId/answers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.event.create.mockResolvedValue({});
    mockTx.question.update.mockResolvedValue({});
  });

  it('creates answer and returns 201', async () => {
    mockTx.question.findFirst.mockResolvedValue({
      id: 'q-1',
      subject: 'Test question',
      status: 'OPEN',
    });
    const created = { id: 'a-1', body: 'This is the answer' };
    mockTx.answer.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions/q-1/answers', {
      method: 'POST',
      body: JSON.stringify({ body: 'This is the answer' }),
    });
    const res = await POST(req, makeContext());
    const responseBody = await res.json();

    expect(res.status).toBe(201);
    expect(responseBody.answer.id).toBe('a-1');
  });

  it('auto-sets question status to ANSWERED when previously OPEN', async () => {
    mockTx.question.findFirst.mockResolvedValue({
      id: 'q-1',
      subject: 'Test question',
      status: 'OPEN',
    });
    mockTx.answer.create.mockResolvedValue({ id: 'a-1', body: 'Answer' });

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions/q-1/answers', {
      method: 'POST',
      body: JSON.stringify({ body: 'Answer' }),
    });
    await POST(req, makeContext());

    expect(mockTx.question.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { status: 'ANSWERED' },
    });
  });

  it('does not change status when question is already CLOSED', async () => {
    mockTx.question.findFirst.mockResolvedValue({
      id: 'q-1',
      subject: 'Test question',
      status: 'CLOSED',
    });
    mockTx.answer.create.mockResolvedValue({ id: 'a-1', body: 'Answer' });

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions/q-1/answers', {
      method: 'POST',
      body: JSON.stringify({ body: 'Answer' }),
    });
    await POST(req, makeContext());

    expect(mockTx.question.update).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent question', async () => {
    mockTx.question.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions/q-1/answers', {
      method: 'POST',
      body: JSON.stringify({ body: 'Answer' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'VIEWER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/questions/q-1/answers', {
      method: 'POST',
      body: JSON.stringify({ body: 'Answer' }),
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(403);
  });
});
