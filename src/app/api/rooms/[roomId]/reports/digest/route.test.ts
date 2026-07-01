import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
  getProviders: vi.fn(),
  hasCapability: vi.fn(),
  createCapabilityUnavailableResponse: vi.fn(),
  addJob: vi.fn(),
  tx: {
    room: {
      findFirst: vi.fn(),
    },
    event: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    question: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    link: {
      count: vi.fn(),
    },
    viewSession: {
      findMany: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
    userOrganization: {
      findMany: vi.fn(),
    },
    roleAssignment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/middleware', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: mocks.withOrgContext,
}));

vi.mock('@/providers', () => ({
  getProviders: mocks.getProviders,
}));

vi.mock('@/lib/deployment-capabilities', () => ({
  hasCapability: mocks.hasCapability,
  createCapabilityUnavailableResponse: mocks.createCapabilityUnavailableResponse,
}));

import { POST } from './route';

describe('POST /api/rooms/:roomId/reports/digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://vaultspace.example.com';
    mocks.requireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'ADMIN' },
    });
    mocks.withOrgContext.mockImplementation(async (_organizationId: string, operation) =>
      operation(mocks.tx)
    );
    mocks.getProviders.mockReturnValue({
      job: {
        addJob: mocks.addJob,
      },
    });
    mocks.hasCapability.mockReturnValue(true);
    mocks.addJob.mockResolvedValue('job-1');

    mocks.tx.room.findFirst.mockResolvedValue({ id: 'room-1', name: 'Diligence Room' });
    mocks.tx.event.count.mockResolvedValue(0);
    mocks.tx.event.findMany.mockResolvedValue([]);
    mocks.tx.question.count.mockResolvedValue(0);
    mocks.tx.question.findMany.mockResolvedValue([]);
    mocks.tx.link.count.mockResolvedValue(0);
    mocks.tx.viewSession.findMany.mockResolvedValue([]);
    mocks.tx.document.findMany.mockResolvedValue([]);
    mocks.tx.roleAssignment.findMany.mockResolvedValue([]);
    mocks.tx.userOrganization.findMany.mockImplementation(async (args) => {
      if (args.where.role === 'ADMIN') {
        return [
          {
            user: {
              id: 'admin-1',
              email: 'admin@example.com',
              firstName: 'Ada',
              lastName: 'Admin',
              isActive: true,
            },
          },
        ];
      }
      return [];
    });
  });

  it('queues digest emails with the supported email.send worker job', async () => {
    const request = new NextRequest('http://localhost/api/rooms/room-1/reports/digest', {
      method: 'POST',
      body: JSON.stringify({ period: 'daily' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: 'Digest email queued',
      jobIds: ['job-1'],
      recipientCount: 1,
    });

    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Daily digest: Diligence Room',
        template: 'room-digest',
        data: expect.objectContaining({
          period: 'daily',
          recipientName: 'Ada Admin',
          roomName: 'Diligence Room',
          roomUrl: 'https://vaultspace.example.com/rooms/room-1',
        }),
      })
    );
  });

  it('does not queue digest emails for inactive users or VaultSpace QA plus-address users', async () => {
    mocks.tx.userOrganization.findMany.mockImplementation(async (args) => {
      if (args.where.role === 'ADMIN') {
        return [
          {
            user: {
              id: 'admin-1',
              email: 'admin@example.com',
              firstName: 'Ada',
              lastName: 'Admin',
              isActive: true,
            },
          },
          {
            user: {
              id: 'admin-2',
              email: 'inactive@example.com',
              firstName: 'Inactive',
              lastName: 'Admin',
              isActive: false,
            },
          },
          {
            user: {
              id: 'admin-3',
              email: 'smoke+vaultspace-qa-20260630@example.com',
              firstName: 'QA',
              lastName: 'Admin',
              isActive: true,
            },
          },
        ];
      }
      return [];
    });

    const request = new NextRequest('http://localhost/api/rooms/room-1/reports/digest', {
      method: 'POST',
      body: JSON.stringify({ period: 'daily' }),
    });
    const context = { params: Promise.resolve({ roomId: 'room-1' }) };

    const response = await POST(request, context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: 'Digest email queued',
      jobIds: ['job-1'],
      recipientCount: 1,
    });
    expect(mocks.addJob).toHaveBeenCalledTimes(1);
    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({ to: 'admin@example.com' })
    );
  });
});
