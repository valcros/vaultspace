import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requirePlatformOperator: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  requirePlatformOperator: mocks.requirePlatformOperator,
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    organization: {
      count: mocks.count,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
    user: {
      count: mocks.count,
    },
    room: {
      count: mocks.count,
    },
    document: {
      count: mocks.count,
    },
    session: {
      groupBy: mocks.groupBy,
    },
  },
}));

import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { GET as getOverview } from './overview/route';
import { POST as postQuota } from './organizations/[orgId]/quota/route';

describe('SysOp Behavioral Authorization Contract (P0 #1b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/sysop/overview', () => {
    it('returns 401 Authentication Required when unauthenticated', async () => {
      mocks.requirePlatformOperator.mockRejectedValue(
        new AuthenticationError('Authentication required')
      );

      const response = await getOverview();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
    });

    it('returns 403 Forbidden when authenticated as non-operator', async () => {
      mocks.requirePlatformOperator.mockRejectedValue(
        new AuthorizationError('Platform operator access required')
      );

      const response = await getOverview();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    });

    it('returns 200 OK with sanitized metrics when authenticated as active operator', async () => {
      mocks.requirePlatformOperator.mockResolvedValue({
        userId: 'op-1',
        organizationId: 'org-1',
      });
      mocks.count.mockResolvedValue(10);
      mocks.groupBy.mockResolvedValue([
        { organizationId: 'org-1', _max: { lastActiveAt: new Date('2026-02-01T00:00:00.000Z') } },
      ]);
      mocks.findMany.mockResolvedValue([
        {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          _count: { rooms: 2, users: 5 },
        },
      ]);

      const response = await getOverview();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.summary).toEqual({
        totalOrganizations: 10,
        totalUsers: 10,
        totalRooms: 10,
        totalDocuments: 10,
        quotaAlertsCount: 0,
        emptyOrganizationsCount: 0,
        pendingUnverifiedOrglessUsers: 10,
      });
      expect(data.infrastructure.environment).toBe('Self-hosted');
      expect(data.organizations).toHaveLength(1);
      expect(data.organizations[0]).toMatchObject({
        createdAt: '2026-01-01T00:00:00.000Z',
        lastAccessAt: '2026-02-01T00:00:00.000Z',
        isEmpty: false,
      });
    });
  });

  describe('POST /api/sysop/organizations/[orgId]/quota', () => {
    it('returns 401 Authentication Required when unauthenticated', async () => {
      mocks.requirePlatformOperator.mockRejectedValue(
        new AuthenticationError('Authentication required')
      );

      const req = new NextRequest('https://vaultspace.org/api/sysop/organizations/org-1/quota', {
        method: 'POST',
        body: JSON.stringify({ quotaGb: 10 }),
      });

      const response = await postQuota(req, { params: Promise.resolve({ orgId: 'org-1' }) });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
    });

    it('returns 403 Forbidden when authenticated as non-operator', async () => {
      mocks.requirePlatformOperator.mockRejectedValue(
        new AuthorizationError('Platform operator access required')
      );

      const req = new NextRequest('https://vaultspace.org/api/sysop/organizations/org-1/quota', {
        method: 'POST',
        body: JSON.stringify({ quotaGb: 10 }),
      });

      const response = await postQuota(req, { params: Promise.resolve({ orgId: 'org-1' }) });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    });

    it('returns 200 OK when authenticated as active operator and org exists', async () => {
      mocks.requirePlatformOperator.mockResolvedValue({
        userId: 'op-1',
        organizationId: 'org-1',
      });
      mocks.findUnique.mockResolvedValue({ id: 'org-1', name: 'Acme Corp' });

      const req = new NextRequest('https://vaultspace.org/api/sysop/organizations/org-1/quota', {
        method: 'POST',
        body: JSON.stringify({ quotaGb: 20 }),
      });

      const response = await postQuota(req, { params: Promise.resolve({ orgId: 'org-1' }) });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        orgId: 'org-1',
        updatedQuotaGb: 20,
      });
    });
  });
});
