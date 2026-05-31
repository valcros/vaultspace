/**
 * Single Share Link API Tests (F116)
 *
 * Tests for individual share link management.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { DELETE, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

const mockAdminSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
};

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', linkId: 'link-1' }) };
}

describe('PATCH /api/rooms/:roomId/links/:linkId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('deactivates existing viewer sessions when a link is deactivated', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        link: {
          findFirst: vi.fn().mockResolvedValue({ id: 'link-1', isActive: true }),
          update: vi.fn().mockResolvedValue({ id: 'link-1', isActive: false }),
        },
        viewSession: { updateMany },
      };

      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links/link-1', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });

    const response = await PATCH(request, makeContext());

    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        linkId: 'link-1',
        organizationId: 'org-1',
        isActive: true,
      },
      data: { isActive: false },
    });
  });
});

describe('DELETE /api/rooms/:roomId/links/:linkId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('revokes the link and deactivates existing viewer sessions for that link', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        link: {
          findFirst: vi.fn().mockResolvedValue({ id: 'link-1', isActive: true }),
          update: vi.fn().mockResolvedValue({ id: 'link-1', isActive: false }),
        },
        viewSession: { updateMany },
      };

      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/links/link-1', {
      method: 'DELETE',
    });

    const response = await DELETE(request, makeContext());

    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        linkId: 'link-1',
        organizationId: 'org-1',
        isActive: true,
      },
      data: { isActive: false },
    });
  });
});
