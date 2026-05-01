import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: vi.fn(() => ({
    can: vi.fn().mockResolvedValue(true),
  })),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

const adminSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
} as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never;

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/rooms/room-1/folders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/rooms/:roomId/folders depth enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(adminSession);
  });

  it('rejects creation under a depth-3 parent with FOLDER_DEPTH_EXCEEDED', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: {
          findFirst: vi.fn().mockResolvedValue({ id: 'room-1', status: 'ACTIVE' }),
        },
        folder: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'fld-q3',
            roomId: 'room-1',
            organizationId: 'org-1',
            path: '/Financials/2025/Q3',
          }),
          aggregate: vi.fn(),
          create: vi.fn(),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(makeRequest({ name: 'Weekly', parentId: 'fld-q3' }), makeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(body.error.details.maxDepth).toBe(3);
    expect(body.error.details.attemptedDepth).toBe(4);
    expect(body.error.details.parentFolderId).toBe('fld-q3');
    expect(body.error.details.operation).toBe('create');
  });

  it('allows creation under a depth-2 parent', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'fld-new',
      roomId: 'room-1',
      organizationId: 'org-1',
      parentId: 'fld-2025',
      name: 'Q4',
      path: '/Financials/2025/Q4',
      displayOrder: 0,
    });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        room: {
          findFirst: vi.fn().mockResolvedValue({ id: 'room-1', status: 'ACTIVE' }),
        },
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-2025',
              roomId: 'room-1',
              organizationId: 'org-1',
              path: '/Financials/2025',
            })
            .mockResolvedValueOnce(null),
          aggregate: vi.fn().mockResolvedValue({ _max: { displayOrder: -1 } }),
          create,
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await POST(makeRequest({ name: 'Q4', parentId: 'fld-2025' }), makeContext());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });
});
