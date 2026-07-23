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
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/db', () => ({
  db: {
    link: {
      findFirst: (...args: unknown[]) => mockLinkFindFirst(...args),
    },
  },
  bootstrapDb: {
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

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { LINK_ACCESS_DENIED: 60_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

import { POST } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

describe('POST /api/view/[shareToken]/access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAccessAudit.mockResolvedValue('disabled');

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
          create: mockViewSessionCreate.mockResolvedValue({ id: 'view-session-1' }),
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
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'LINK_ACCESSED',
        viewSessionId: 'view-session-1',
      })
    );
  });

  it('records a rate-limited denial without logging the submitted password', async () => {
    mockLinkFindFirst.mockResolvedValue({
      id: 'link-1',
      slug: 'share-token',
      requiresEmailVerification: false,
      allowedEmails: [],
      requiresPassword: true,
      passwordHash: 'stored-hash',
      room: {
        id: 'room-1',
        name: 'Room',
        organizationId: 'org-1',
        requiresNda: false,
        ndaContent: null,
        ipAllowlist: [],
      },
    });

    const response = await POST(
      new NextRequest('http://localhost:3000/api/view/share-token/access', {
        method: 'POST',
        body: JSON.stringify({ password: 'must-never-be-logged' }),
      }),
      makeContext('share-token')
    );

    expect(response.status).toBe(401);
    const auditInput = mockCaptureAccessAudit.mock.calls[0]?.[0];
    expect(auditInput).toEqual(
      expect.objectContaining({
        eventType: 'LINK_ACCESS_DENIED',
        dedupeByIp: true,
        metadata: expect.objectContaining({ reason: 'PASSWORD_INVALID' }),
      })
    );
    expect(JSON.stringify(auditInput)).not.toContain('must-never-be-logged');
  });

  it('keeps successful link access available when the bounded audit write fails', async () => {
    mockCaptureAccessAudit.mockResolvedValue('failed');

    const response = await POST(
      new NextRequest('http://localhost:3000/api/view/share-token/access', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeContext('share-token')
    );

    expect(response.status).toBe(200);
    expect(mockCookieStore.set).toHaveBeenCalledTimes(1);
  });
});
