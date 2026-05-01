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
import { PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

const adminSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
} as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never;

function makeContext(folderId = 'fld-source') {
  return { params: Promise.resolve({ roomId: 'room-1', folderId }) };
}

function makeRequest(body: unknown, folderId = 'fld-source') {
  return new NextRequest(`http://localhost/api/rooms/room-1/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('PATCH /api/rooms/:roomId/folders/:folderId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(adminSession);
  });

  it('returns 400 INVALID_INPUT when neither name nor parentId is provided', async () => {
    const response = await PATCH(makeRequest({}), makeContext());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('renames a folder when only name is provided', async () => {
    const update = vi.fn().mockResolvedValue({
      id: 'fld-source',
      name: 'NewName',
      path: '/NewName',
      parentId: null,
    });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-source',
              name: 'OldName',
              path: '/OldName',
              parentId: null,
            })
            .mockResolvedValueOnce(null), // duplicate check
          findMany: vi.fn().mockResolvedValue([]),
          update,
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await PATCH(makeRequest({ name: 'NewName' }), makeContext());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.folder.name).toBe('NewName');
    expect(update).toHaveBeenCalledOnce();
  });

  it('rejects move into self', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-source',
              name: 'Source',
              path: '/Source',
              parentId: null,
            })
            .mockResolvedValueOnce({ id: 'fld-source', path: '/Source' }),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await PATCH(makeRequest({ parentId: 'fld-source' }), makeContext());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/itself/i);
  });

  it('rejects move into a descendant', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-source',
              name: 'Source',
              path: '/Source',
              parentId: null,
            })
            .mockResolvedValueOnce({ id: 'fld-child', path: '/Source/Child' }),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await PATCH(makeRequest({ parentId: 'fld-child' }), makeContext());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/descendant/i);
  });

  it('rejects move that would push subtree past depth 3', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-source',
              name: 'HR',
              path: '/HR',
              parentId: null,
            })
            .mockResolvedValueOnce({ id: 'fld-q3', path: '/Financials/2025/Q3' }),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await PATCH(makeRequest({ parentId: 'fld-q3' }), makeContext());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(body.error.details.attemptedDepth).toBe(4);
    expect(body.error.details.operation).toBe('move');
  });

  it('successfully re-parents a folder and rewrites descendant paths', async () => {
    const update = vi.fn().mockImplementation(({ where, data }) => ({
      id: where.id,
      ...data,
    }));

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        folder: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'fld-source',
              name: 'Q4',
              path: '/Q4',
              parentId: null,
            })
            .mockResolvedValueOnce({ id: 'fld-financials', path: '/Financials' })
            .mockResolvedValueOnce(null), // duplicate path check
          findMany: vi.fn().mockResolvedValue([{ id: 'fld-q4-team', path: '/Q4/Team' }]),
          update,
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await PATCH(makeRequest({ parentId: 'fld-financials' }), makeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fld-source' },
        data: expect.objectContaining({
          parentId: 'fld-financials',
          path: '/Financials/Q4',
        }),
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fld-q4-team' },
        data: { path: '/Financials/Q4/Team' },
      })
    );
  });
});
