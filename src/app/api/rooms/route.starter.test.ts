import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuthFromRequest: vi.fn(),
  withOrgContext: vi.fn(),
  roomCreate: vi.fn(),
  roomTemplateFindFirst: vi.fn(),
  folderCreateMany: vi.fn(),
  folderFindMany: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  requireAuthFromRequest: mocks.requireAuthFromRequest,
  getRequestContext: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { POST } from './route';

const session = {
  userId: 'user-1',
  organizationId: 'org-1',
  user: { email: 'admin@example.com' },
  organization: { role: 'ADMIN' },
};

describe('POST /api/rooms starter folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthFromRequest.mockResolvedValue(session);
    mocks.roomCreate.mockResolvedValue({ id: 'room-1', name: 'Investor Room', status: 'DRAFT' });
    mocks.folderFindMany.mockImplementation(({ where }: { where: { path: { in: string[] } } }) =>
      Promise.resolve(where.path.in.map((path) => ({ id: `id-${path}`, path })))
    );
    mocks.withOrgContext.mockImplementation(
      async (_organizationId: string, callback: (tx: unknown) => unknown) =>
        callback({
          room: { create: mocks.roomCreate },
          roomTemplate: { findFirst: mocks.roomTemplateFindFirst },
          folder: { createMany: mocks.folderCreateMany, findMany: mocks.folderFindMany },
          event: { create: mocks.eventCreate },
        })
    );
  });

  it('creates only selected template folders plus their required parent', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Investor Room',
          templateId: 'investor-data-room',
          selectedFolderPaths: ['/financials/historical-financials'],
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.folderCreateMany).toHaveBeenCalledTimes(2);
    expect(mocks.folderCreateMany.mock.calls[0]![0].data).toEqual([
      expect.objectContaining({ name: 'Financials', path: '/financials', parentId: null }),
    ]);
    expect(mocks.folderCreateMany.mock.calls[1]![0].data).toEqual([
      expect.objectContaining({
        name: 'Historical Financials',
        path: '/financials/historical-financials',
        parentId: 'id-/financials',
      }),
    ]);
    expect(mocks.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: { templateId: 'investor-data-room', starterFolderCount: 2 },
        }),
      })
    );
  });

  it('rejects a selected path that is not part of the selected template', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Investor Room',
          templateId: 'investor-data-room',
          selectedFolderPaths: ['/not-in-the-template'],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.roomCreate).not.toHaveBeenCalled();
    expect(mocks.folderCreateMany).not.toHaveBeenCalled();
  });

  it('continues to create an empty room when no starter template is chosen', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: 'Private Working Room' }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.roomCreate).toHaveBeenCalledOnce();
    expect(mocks.folderCreateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before attempting to create a room', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        body: '{',
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'MALFORMED_JSON' });
    expect(mocks.roomCreate).not.toHaveBeenCalled();
  });
});
