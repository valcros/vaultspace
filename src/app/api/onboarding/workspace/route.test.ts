import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationUpdateMany: vi.fn(),
  roomCount: vi.fn(),
  roomFindFirst: vi.fn(),
  roomUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/errors', () => ({ isAuthenticationError: () => false }));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { GET, POST } from './route';

const session = {
  userId: 'user-1',
  user: { email: 'owner@example.com' },
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
};

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/onboarding/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('workspace setup API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.organizationFindUnique.mockResolvedValue({
      name: "Alice's Organization",
      slug: 'org-1756789012345-abc12',
      workspaceUrlClaimedAt: null,
    });
    mocks.roomCount.mockResolvedValue(1);
    mocks.roomFindFirst.mockResolvedValue({ id: 'room-initial', name: 'My First Data Room' });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.roomUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventCreate.mockResolvedValue({});
    const tx = {
      organization: {
        findUnique: mocks.organizationFindUnique,
        updateMany: mocks.organizationUpdateMany,
      },
      room: {
        count: mocks.roomCount,
        findFirst: mocks.roomFindFirst,
        updateMany: mocks.roomUpdateMany,
      },
      event: { create: mocks.eventCreate },
    };
    mocks.withOrgContext.mockImplementation(
      async (_organizationId: string, operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx)
    );
  });

  it('returns the initial workspace and room values only while onboarding is eligible', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      onboardingRequired: true,
      organization: { name: "Alice's Organization", suggestedSlug: 'alice-s-organization' },
      starterRoom: { id: 'room-initial', name: 'My First Data Room' },
    });
  });

  it('atomically claims the workspace URL and names the untouched starter room', async () => {
    const response = await POST(
      request({
        organizationName: 'Acme Holdings',
        workspaceSlug: 'Acme-Holdings',
        roomName: 'Series A Data Room',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspace: {
        name: 'Acme Holdings',
        slug: 'acme-holdings',
        url: 'https://acme-holdings.vaultspace.org',
      },
      room: { id: 'room-initial' },
    });
    expect(mocks.organizationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'org-1',
          slug: 'org-1756789012345-abc12',
          workspaceUrlClaimedAt: null,
        }),
        data: expect.objectContaining({
          name: 'Acme Holdings',
          slug: 'acme-holdings',
          workspaceUrlClaimedAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.roomUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'room-initial',
          slug: 'my-first-data-room',
          status: 'DRAFT',
        }),
        data: { name: 'Series A Data Room' },
      })
    );
    expect(mocks.eventCreate).toHaveBeenCalledOnce();
  });

  it('rejects reserved subdomains before any organization or room mutation', async () => {
    const response = await POST(
      request({ organizationName: 'Acme', workspaceSlug: 'admin', roomName: 'Data Room' })
    );

    expect(response.status).toBe(400);
    expect(mocks.organizationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.roomUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a second claim or an existing non-provisional organization', async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      slug: 'acme',
      workspaceUrlClaimedAt: new Date(),
    });

    const response = await POST(
      request({ organizationName: 'Acme', workspaceSlug: 'another-acme', roomName: 'Data Room' })
    );

    expect(response.status).toBe(409);
    expect(mocks.organizationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.roomUpdateMany).not.toHaveBeenCalled();
  });

  it('denies a non-admin before inspecting onboarding state', async () => {
    mocks.requireAuth.mockResolvedValue({ ...session, organization: { role: 'VIEWER' } });

    const response = await POST(
      request({ organizationName: 'Acme', workspaceSlug: 'acme', roomName: 'Data Room' })
    );

    expect(response.status).toBe(403);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });
});
