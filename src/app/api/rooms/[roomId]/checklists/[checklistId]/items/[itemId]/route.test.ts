/**
 * Checklist Item API Tests
 *
 * Validates PATCH (update status, completion tracking) and DELETE operations,
 * plus 404/403 error paths.
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

// Mock providers
vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: { exists: vi.fn(), get: vi.fn() },
    job: { addJob: vi.fn(() => Promise.resolve()) },
  }),
}));

// Mock DB transaction
const mockTx = {
  room: { findFirst: vi.fn() },
  checklist: { findFirst: vi.fn() },
  checklistItem: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  document: { findFirst: vi.fn() },
  event: { create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { PATCH, DELETE } from './route';

function makeContext() {
  return {
    params: Promise.resolve({ roomId: 'room-1', checklistId: 'cl-1', itemId: 'item-1' }),
  };
}

function makePatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3000/api/rooms/room-1/checklists/cl-1/items/item-1'),
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3000/api/rooms/room-1/checklists/cl-1/items/item-1'),
    { method: 'DELETE' }
  );
}

const mockRoom = { id: 'room-1', organizationId: 'org-1' };
const mockChecklist = { id: 'cl-1', roomId: 'room-1' };
const mockItem = { id: 'item-1', name: 'Upload NDA', status: 'PENDING', checklistId: 'cl-1' };

describe('Checklist Item API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.checklist.findFirst.mockResolvedValue(mockChecklist);
    mockTx.checklistItem.findFirst.mockResolvedValue(mockItem);
    mockTx.checklistItem.update.mockResolvedValue({ ...mockItem, status: 'IN_PROGRESS' });
    mockTx.checklistItem.delete.mockResolvedValue({});
    mockTx.event.create.mockResolvedValue({});
  });

  describe('PATCH', () => {
    it('updates item status and returns updated item', async () => {
      const res = await PATCH(makePatchRequest({ status: 'IN_PROGRESS' }), makeContext());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.item.status).toBe('IN_PROGRESS');
      expect(mockTx.checklistItem.update).toHaveBeenCalled();
    });

    it('sets completedAt and completedByUserId when status becomes COMPLETE', async () => {
      mockTx.checklistItem.update.mockResolvedValue({ ...mockItem, status: 'COMPLETE' });
      await PATCH(makePatchRequest({ status: 'COMPLETE' }), makeContext());
      const updateCall = mockTx.checklistItem.update.mock.calls[0]![0];
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
      expect(updateCall.data.completedByUserId).toBe('user-1');
    });

    it('returns 404 for non-existent item', async () => {
      mockTx.checklistItem.findFirst.mockResolvedValue(null);
      const res = await PATCH(makePatchRequest({ status: 'IN_PROGRESS' }), makeContext());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Checklist item not found');
    });

    it('returns 403 for non-admin users', async () => {
      mockSession.organization.role = 'MEMBER';
      const res = await PATCH(makePatchRequest({ status: 'IN_PROGRESS' }), makeContext());
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Admin access required');
    });
  });

  describe('DELETE', () => {
    it('removes item and returns success', async () => {
      const res = await DELETE(makeDeleteRequest(), makeContext());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockTx.checklistItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
    });

    it('returns 404 for non-existent item', async () => {
      mockTx.checklistItem.findFirst.mockResolvedValue(null);
      const res = await DELETE(makeDeleteRequest(), makeContext());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Checklist item not found');
    });
  });
});
