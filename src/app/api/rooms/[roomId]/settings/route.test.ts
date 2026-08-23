import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getRequestContext: vi.fn(),
  createServiceContext: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  requireAuth: mocks.requireAuth,
  getRequestContext: mocks.getRequestContext,
}));

vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

vi.mock('@/services', () => ({
  createServiceContext: mocks.createServiceContext,
  roomService: { update: mocks.update },
}));

vi.mock('@/lib/deployment-capabilities', () => ({ hasCapability: vi.fn() }));

import { PATCH } from './route';

const session = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
};

const updatedRoom = {
  id: 'room-1',
  name: 'Authorized room',
  description: null,
  status: 'ACTIVE',
  requiresPassword: false,
  requiresEmailVerification: false,
  allowDownloads: false,
  defaultExpiryDays: null,
  requiresNda: false,
  ndaContent: null,
  brandColor: null,
  brandLogoUrl: 'https://example.test/logo.svg',
  enableWatermark: false,
  watermarkTemplate: null,
  ipAllowlist: ['192.0.2.0/24'],
  archivedAt: null,
  closedAt: null,
};

describe('PATCH /api/rooms/[roomId]/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.getRequestContext.mockReturnValue({
      requestId: 'request-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    mocks.createServiceContext.mockReturnValue({ session, requestId: 'request-1' });
    mocks.update.mockResolvedValue(updatedRoom);
  });

  it('delegates combined settings and lifecycle updates to the canonical service', async () => {
    const response = await PATCH(
      new NextRequest('https://vaultspace.org/api/rooms/room-1/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'ACTIVE',
          allowDownloads: false,
          brandLogoUrl: 'https://example.test/logo.svg',
          ipAllowlist: ['192.0.2.0/24'],
        }),
      }),
      { params: Promise.resolve({ roomId: 'room-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ session, requestId: 'request-1' }, 'room-1', {
      status: 'ACTIVE',
      allowDownloads: false,
      brandLogoUrl: 'https://example.test/logo.svg',
      ipAllowlist: ['192.0.2.0/24'],
    });
  });

  it('rejects invalid logo URLs and allowlist values before mutation', async () => {
    const insecureLogo = await PATCH(
      new NextRequest('https://vaultspace.org/api/rooms/room-1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ brandLogoUrl: 'http://example.test/logo.svg' }),
      }),
      { params: Promise.resolve({ roomId: 'room-1' }) }
    );
    const invalidAllowlist = await PATCH(
      new NextRequest('https://vaultspace.org/api/rooms/room-1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ipAllowlist: ['203.0.113.256'] }),
      }),
      { params: Promise.resolve({ roomId: 'room-1' }) }
    );

    expect(insecureLogo.status).toBe(400);
    expect(invalidAllowlist.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
