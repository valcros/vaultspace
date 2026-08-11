/**
 * Viewer Link Info API Tests (Issue 3)
 *
 * Validates NDA field propagation and individual gate booleans.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetLinkPolicyRecord = vi.fn();
const mockEvaluateLinkState = vi.fn();
const mockGetViewerSession = vi.fn();
const mockRequireViewerSession = vi.fn();
vi.mock('@/lib/permissions/LinkPolicy', () => ({
  getLinkPolicyRecord: (...args: unknown[]) => mockGetLinkPolicyRecord(...args),
  evaluateLinkState: (...args: unknown[]) => mockEvaluateLinkState(...args),
}));

vi.mock('@/lib/viewerSession', () => ({
  viewerSessionBaseSelect: {},
  getViewerSession: (...args: unknown[]) => mockGetViewerSession(...args),
  requireViewerSession: (...args: unknown[]) => mockRequireViewerSession(...args),
}));

import { GET } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

const baseLink = {
  id: 'link-1',
  name: 'Test Link',
  slug: 'test-token',
  isActive: true,
  expiresAt: null,
  requiresPassword: false,
  requiresEmailVerification: false,
  allowedEmails: [],
  room: {
    name: 'Test Room',
    requiresNda: false,
    ndaContent: null,
  },
  organization: {
    name: 'Test Org',
    logoUrl: null,
  },
};

describe('GET /api/view/[shareToken]/info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateLinkState.mockReturnValue({ allowed: true });
    mockGetViewerSession.mockResolvedValue(null);
    mockRequireViewerSession.mockReturnValue({ response: {} });
  });

  it('returns 404 for invalid/expired link', async () => {
    mockGetLinkPolicyRecord.mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/view/bad-token/info');
    const res = await GET(req, makeContext('bad-token'));
    expect(res.status).toBe(404);
  });

  describe('NDA fields (Issue 3a)', () => {
    it('returns ndaRequired: true and ndaText when room has NDA', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue({
        ...baseLink,
        room: {
          name: 'NDA Room',
          requiresNda: true,
          ndaContent: 'You must keep this confidential.',
        },
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.link.ndaRequired).toBe(true);
      expect(body.link.ndaText).toBe('You must keep this confidential.');
    });

    it('returns ndaRequired: false when room has no NDA', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.ndaRequired).toBe(false);
      expect(body.link.ndaText).toBeNull();
    });
  });

  describe('Gate booleans (Issue 3b)', () => {
    it('returns both requiresPassword and requiresEmail when both are set', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue({
        ...baseLink,
        requiresPassword: true,
        requiresEmailVerification: true,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(true);
      expect(body.link.requiresEmail).toBe(true);
    });

    it('returns only requiresPassword when only password is set', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue({
        ...baseLink,
        requiresPassword: true,
        requiresEmailVerification: false,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(true);
      expect(body.link.requiresEmail).toBe(false);
    });

    it('returns only requiresEmail when only email is set', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue({
        ...baseLink,
        requiresPassword: false,
        requiresEmailVerification: true,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(false);
      expect(body.link.requiresEmail).toBe(true);
    });

    it('requires an email field when an allowlist exists', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue({
        ...baseLink,
        allowedEmails: ['allowed@example.test'],
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresEmail).toBe(true);
    });

    it('does not return accessType (removed)', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link).not.toHaveProperty('accessType');
    });
  });

  describe('central policy delegation', () => {
    it('loads the complete policy record and applies the admission-state gate', async () => {
      mockGetLinkPolicyRecord.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      await GET(req, makeContext('test-token'));

      expect(mockGetLinkPolicyRecord).toHaveBeenCalledWith('test-token');
      expect(mockEvaluateLinkState).toHaveBeenCalledWith(baseLink, { admission: true });
    });
  });

  it('does not apply maxViews as a new-admission gate to an existing valid session', async () => {
    mockGetLinkPolicyRecord.mockResolvedValue(baseLink);
    mockGetViewerSession.mockResolvedValue({ id: 'viewer-session-1' });
    mockRequireViewerSession.mockReturnValue({ session: { id: 'viewer-session-1' } });

    const response = await GET(
      new NextRequest('http://localhost:3000/api/view/test-token/info'),
      makeContext('test-token')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.link.alreadyAdmitted).toBe(true);
    expect(mockEvaluateLinkState).toHaveBeenCalledWith(baseLink, { admission: false });
  });
});
