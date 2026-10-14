import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  organizationFindFirst: vi.fn(),
  roomFindFirst: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  accessRequestCreate: vi.fn(),
  eventCreate: vi.fn(),
  withOrgContext: vi.fn(),
  notifyRoomAdministrators: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    organization: { findFirst: mocks.organizationFindFirst },
    room: { findFirst: mocks.roomFindFirst },
    accessRequest: { findFirst: mocks.accessRequestFindFirst },
  },
  withOrgContext: mocks.withOrgContext,
}));
vi.mock('@/services/notifications/InAppNotificationService', () => ({
  notifyRoomAdministrators: mocks.notifyRoomAdministrators,
}));

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost/api/rooms/public/request-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationSlug: 'test-org',
      roomSlug: 'test-room',
      email: 'viewer@example.test',
    }),
  });
}

describe('public access request notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationFindFirst.mockResolvedValue({ id: 'org-1' });
    mocks.roomFindFirst.mockResolvedValue({ id: 'room-1', status: 'ACTIVE' });
    mocks.accessRequestFindFirst.mockResolvedValue(null);
    mocks.accessRequestCreate.mockResolvedValue({ id: 'request-1' });
    mocks.eventCreate.mockResolvedValue({ id: 'event-1' });
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) =>
        callback({
          accessRequest: { create: mocks.accessRequestCreate },
          event: { create: mocks.eventCreate },
        })
    );
  });

  it('writes an audit event and scoped admin notification in the request transaction', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        roomId: 'room-1',
        eventType: 'ACCESS_REQUEST_SUBMITTED',
        metadata: { accessRequestId: 'request-1' },
      }),
    });
    expect(mocks.notifyRoomAdministrators).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-1',
        roomId: 'room-1',
        sourceEventId: 'event-1',
        type: 'ACCESS_REQUEST',
        actionPath: '/rooms/room-1?manage=members',
      })
    );
  });

  it('does not publish another notice for an already pending request', async () => {
    mocks.accessRequestFindFirst.mockResolvedValue({ id: 'already-pending' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
    expect(mocks.notifyRoomAdministrators).not.toHaveBeenCalled();
  });
});
