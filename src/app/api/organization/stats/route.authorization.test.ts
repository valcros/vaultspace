import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { GET } from './route';

describe('GET /api/organization/stats authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose organization-wide aggregates to viewers', async () => {
    mocks.requireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });
});
