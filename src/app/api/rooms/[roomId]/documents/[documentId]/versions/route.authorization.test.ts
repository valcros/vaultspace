import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  requireAuth: vi.fn(),
}));

const mockTx = {
  document: { findFirst: vi.fn() },
  documentVersion: { findMany: vi.fn() },
};

vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));
vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: () => ({ can: mocks.can }),
}));
vi.mock('@/providers', () => ({ getProviders: vi.fn() }));

import { GET } from './route';

function request() {
  return new NextRequest('https://vaultspace.org/api/rooms/room-1/documents/doc-1/versions');
}

function context(roomId = 'room-1', documentId = 'doc-1') {
  return { params: Promise.resolve({ roomId, documentId }) };
}

describe('GET document versions authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
    mockTx.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      roomId: 'room-1',
      folderId: 'folder-1',
    });
  });

  it('returns 404 before loading versions when document VIEW is denied', async () => {
    mocks.can.mockResolvedValue(false);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mockTx.documentVersion.findMany).not.toHaveBeenCalled();
  });

  it('loads versions only after document VIEW is allowed', async () => {
    mocks.can.mockResolvedValue(true);
    mockTx.documentVersion.findMany.mockResolvedValue([]);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.can).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'view',
      {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-1',
        folderId: 'folder-1',
        documentId: 'doc-1',
      },
      mockTx
    );
    expect(mockTx.documentVersion.findMany).toHaveBeenCalled();
  });

  it('rejects invalid route identifiers before authentication or database access', async () => {
    const response = await GET(request(), context(' ', 'doc-1'));

    expect(response.status).toBe(400);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mockTx.document.findFirst).not.toHaveBeenCalled();
  });
});
