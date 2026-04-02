/**
 * Room Duplication API Tests
 *
 * Validates POST for duplicating a room's structure.
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
  room: { findFirst: vi.fn(), create: vi.fn() },
  folder: { findMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { POST } from './route';

const mockSourceRoom = {
  id: 'room-1',
  organizationId: 'org-1',
  name: 'Series A Room',
  description: 'Due diligence room',
  allowDownloads: true,
  defaultExpiryDays: 30,
  requiresNda: false,
  ndaContent: null,
  enableWatermark: false,
  watermarkTemplate: null,
  requiresEmailVerification: false,
  allDocumentsConfidential: false,
};

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('POST /api/rooms/:roomId/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockSourceRoom);
    mockTx.folder.findMany.mockResolvedValue([]);
  });

  it('creates new room with "Copy of" prefix and returns 201', async () => {
    const duplicated = { id: 'room-new', name: 'Copy of Series A Room', status: 'DRAFT' };
    mockTx.room.create.mockResolvedValue(duplicated);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/duplicate', {
      method: 'POST',
    });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.room.name).toBe('Copy of Series A Room');
  });

  it('copies folder structure', async () => {
    const folders = [
      {
        id: 'f-1',
        name: 'Legal',
        path: '/Legal',
        parentId: null,
        displayOrder: 0,
        confidential: false,
      },
      {
        id: 'f-2',
        name: 'Finance',
        path: '/Finance',
        parentId: null,
        displayOrder: 1,
        confidential: true,
      },
    ];
    mockTx.folder.findMany.mockResolvedValue(folders);
    mockTx.room.create.mockResolvedValue({ id: 'room-new', name: 'Copy of Series A Room' });
    mockTx.folder.create
      .mockResolvedValueOnce({ id: 'f-new-1' })
      .mockResolvedValueOnce({ id: 'f-new-2' });

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/duplicate', {
      method: 'POST',
    });
    await POST(req, makeContext());

    expect(mockTx.folder.create).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for non-existent room', async () => {
    mockTx.room.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-999/duplicate', {
      method: 'POST',
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/duplicate', {
      method: 'POST',
    });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(403);
  });
});
