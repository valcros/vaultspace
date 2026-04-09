import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const mockLinkFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
const mockViewSessionCreate = vi.fn();
const mockLinkUpdate = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/db', () => ({
  db: {
    link: {
      findFirst: (...args: unknown[]) => mockLinkFindFirst(...args),
    },
  },
  withOrgContext: (...args: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/utils/ip', () => ({
  isIpAllowed: vi.fn(() => true),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { POST } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

describe('POST /api/view/[shareToken]/access', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLinkFindFirst.mockResolvedValue({
      id: 'link-1',
      slug: 'share-token',
      requiresEmailVerification: false,
      allowedEmails: [],
      requiresPassword: false,
      passwordHash: null,
      room: {
        id: 'room-1',
        name: 'Room',
        organizationId: 'org-1',
        requiresNda: false,
        ndaContent: null,
        ipAllowlist: [],
      },
    });

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        viewSession: {
          create: mockViewSessionCreate.mockResolvedValue(undefined),
        },
        link: {
          update: mockLinkUpdate.mockResolvedValue(undefined),
        },
      };

      return callback(tx as Parameters<typeof callback>[0]);
    });
  });

  it('sets the viewer session cookie at root path so API routes receive it', async () => {
    const request = new NextRequest('http://localhost:3000/api/view/share-token/access', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request, makeContext('share-token'));

    expect(response.status).toBe(200);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'viewer_share-token',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
    );
    expect(mockViewSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockLinkUpdate).toHaveBeenCalledTimes(1);
  });
});
