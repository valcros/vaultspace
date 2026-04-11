/**
 * Messages Inbox API Tests
 *
 * Validates GET for inbox messages received by the current user.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'VIEWER' },
  user: { email: 'member@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuthFromRequest: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction
const mockTx = {
  message: { findMany: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';
import { requireAuthFromRequest } from '@/lib/middleware';

describe('GET /api/messages/inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuthFromRequest as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  it('returns inbox messages', async () => {
    const messages = [
      {
        id: 'msg-1',
        subject: 'Welcome',
        body: 'Hello there',
        sender: { id: 'u-admin', email: 'admin@example.com', firstName: 'Admin', lastName: 'User' },
        room: { id: 'room-1', name: 'Deal Room' },
        document: null,
        isRead: false,
        readAt: null,
        createdAt: new Date('2026-04-01T10:00:00Z'),
      },
    ];
    mockTx.message.findMany.mockResolvedValue(messages);

    const req = new NextRequest('http://localhost:3000/api/messages/inbox');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].subject).toBe('Welcome');
    expect(body.messages[0].sender.email).toBe('admin@example.com');
  });

  it('returns empty array when no messages', async () => {
    mockTx.message.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/messages/inbox');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toEqual([]);
  });

  it('returns error for unauthenticated', async () => {
    (requireAuthFromRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Authentication required')
    );

    const req = new NextRequest('http://localhost:3000/api/messages/inbox');
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});
