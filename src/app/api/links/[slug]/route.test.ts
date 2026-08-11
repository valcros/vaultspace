import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockLinkFindFirst = vi.fn();
const mockGetLinkPolicyRecord = vi.fn();
const mockEvaluateLinkState = vi.fn();
const mockAdmitLinkViewer = vi.fn();
const mockCaptureAccessAudit = vi.fn();

vi.mock('@/lib/db', () => ({
  bootstrapDb: { link: { findFirst: (...args: unknown[]) => mockLinkFindFirst(...args) } },
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { LINK_ACCESS_DENIED: 60_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
}));

vi.mock('@/providers', () => ({ getProviders: vi.fn() }));

vi.mock('@/lib/permissions/LinkPolicy', () => ({
  getLinkPolicyRecord: (...args: unknown[]) => mockGetLinkPolicyRecord(...args),
  evaluateLinkState: (...args: unknown[]) => mockEvaluateLinkState(...args),
  admitLinkViewer: (...args: unknown[]) => mockAdmitLinkViewer(...args),
}));

import { GET, POST } from './route';

function makeContext() {
  return { params: Promise.resolve({ slug: 'share-link' }) };
}

describe('POST /api/links/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockGetLinkPolicyRecord.mockResolvedValue({
      id: 'link-1',
      organizationId: 'org-1',
      roomId: 'room-1',
      slug: 'share-link',
      name: 'Synthetic Link',
      permission: 'VIEW',
      scope: 'ENTIRE_ROOM',
      scopedFolderId: null,
      scopedDocumentId: null,
      requiresPassword: false,
      requiresEmailVerification: false,
      allowedEmails: [],
      room: { name: 'Synthetic Room', ndaContent: null },
      organization: {
        name: 'Synthetic Organization',
        logoUrl: null,
        primaryColor: '#2563eb',
      },
    });
    mockEvaluateLinkState.mockReturnValue({ allowed: true });
    mockAdmitLinkViewer.mockResolvedValue({
      allowed: true,
      session: { id: 'viewer-session-1' },
      sessionToken: 'session-token',
      normalizedEmail: null,
    });
  });

  it.each([{ email: 42 }, { email: 'not-an-email' }, { password: { nested: true } }])(
    'returns 400 before link lookup for malformed body %#',
    async (body) => {
      const response = await POST(
        new NextRequest('http://localhost/api/links/share-link', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        makeContext()
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid request' });
      expect(mockLinkFindFirst).not.toHaveBeenCalled();
    }
  );

  it('applies the central admission-state policy to public link information', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/links/share-link'),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(mockEvaluateLinkState).toHaveBeenCalledWith(expect.anything(), { admission: true });
  });

  it('delegates session creation and max-view consumption to the central policy', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/links/share-link', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.0.2.10' },
        body: JSON.stringify({}),
      }),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(mockAdmitLinkViewer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceIp: '192.0.2.10' })
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ sessionToken: 'session-token', roomId: 'room-1' })
    );
  });
});
