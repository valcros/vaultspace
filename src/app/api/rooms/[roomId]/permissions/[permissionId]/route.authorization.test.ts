import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { GET } from './route';

describe('GET permission detail authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose a permission record to viewers', async () => {
    mocks.requireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    });

    const response = await GET(
      new NextRequest('https://vaultspace.org/api/rooms/room-1/permissions/permission-1'),
      {
        params: Promise.resolve({ roomId: 'room-1', permissionId: 'permission-1' }),
      }
    );

    expect(response.status).toBe(403);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });
});
