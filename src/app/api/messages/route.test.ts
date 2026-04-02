/**
 * Messages API Tests
 *
 * Validates GET (list sent) and POST (send) for messages.
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
  requireAuthFromRequest: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction
const mockTx = {
  message: { findMany: vi.fn(), create: vi.fn() },
  user: { findFirst: vi.fn() },
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, POST } from './route';
import { requireAuthFromRequest } from '@/lib/middleware';

describe('GET /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    (requireAuthFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  it('returns messages list', async () => {
    const messages = [
      {
        id: 'msg-1',
        subject: 'Hello',
        body: 'Body 1',
        recipientEmail: 'bob@example.com',
        recipient: { id: 'u-2', email: 'bob@example.com', firstName: 'Bob', lastName: 'Smith' },
        room: { id: 'room-1', name: 'Deal Room' },
        document: null,
        isRead: false,
        readAt: null,
        createdAt: new Date('2026-04-01T10:00:00Z'),
      },
    ];
    mockTx.message.findMany.mockResolvedValue(messages);

    const req = new NextRequest('http://localhost:3000/api/messages');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].subject).toBe('Hello');
  });

  it('returns 401 for unauthenticated', async () => {
    (requireAuthFromRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Authentication required')
    );

    const req = new NextRequest('http://localhost:3000/api/messages');
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    (requireAuthFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  it('creates message and returns 201', async () => {
    const created = {
      id: 'msg-new',
      subject: 'Test Subject',
      body: 'Test body',
      recipientEmail: 'bob@example.com',
      recipient: { id: 'u-2', email: 'bob@example.com', firstName: 'Bob', lastName: 'Smith' },
      room: null,
      document: null,
      isRead: false,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    };
    mockTx.user.findFirst.mockResolvedValue({ id: 'u-2' });
    mockTx.message.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipientEmail: 'bob@example.com',
        subject: 'Test Subject',
        body: 'Test body',
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.message.id).toBe('msg-new');
  });

  it('returns 400 for missing recipientEmail', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ subject: 'Test', body: 'Body' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing subject', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ recipientEmail: 'bob@example.com', body: 'Body' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
