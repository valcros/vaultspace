/**
 * SysOp organization PATCH (enable/disable) tests.
 * Behavioral authorization contract + self-lockout + keep-list + audit scoping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { AuthenticationError, AuthorizationError } from '@/lib/errors';

const mockRequireOperator = vi.fn();
const mockCaptureAudit = vi.fn().mockResolvedValue('captured');
const mockOrgUpdate = vi.fn();
const mockUserOrgFindFirst = vi.fn();
const mockOrgFindMany = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requirePlatformOperator: () => mockRequireOperator(),
  getRequestContext: () => ({ requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}));

vi.mock('@/lib/audit/securityAudit', () => ({
  captureSecurityAudit: (input: unknown) => mockCaptureAudit(input),
}));

vi.mock('@/lib/db', () => {
  const client = {
    userOrganization: { findFirst: (...a: unknown[]) => mockUserOrgFindFirst(...a) },
    organization: {
      findMany: (...a: unknown[]) => mockOrgFindMany(...a),
      update: (...a: unknown[]) => mockOrgUpdate(...a),
    },
  };
  return { db: client, bootstrapDb: client };
});

import { PATCH } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sysop/organizations/org-x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ orgId: 'org-x' }) };
const operatorSession = {
  userId: 'op-1',
  organizationId: 'op-org',
  user: { email: 'op@example.com' },
};

describe('PATCH /api/sysop/organizations/[orgId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['PLATFORM_PROTECTED_ORG_SLUGS'] = JSON.stringify(['protected-tenant-a']);
    mockRequireOperator.mockResolvedValue(operatorSession);
    mockUserOrgFindFirst.mockResolvedValue(null);
    mockOrgFindMany.mockResolvedValue([]); // no protected org matches by default
    mockCaptureAudit.mockResolvedValue('captured');
    mockOrgUpdate.mockResolvedValue({
      id: 'org-x',
      name: 'Junk Org',
      slug: 'org-x',
      isActive: false,
    });
  });

  it('unauthenticated → 401', async () => {
    mockRequireOperator.mockRejectedValue(new AuthenticationError());
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(401);
  });

  it('authed non-operator → 403', async () => {
    mockRequireOperator.mockRejectedValue(new AuthorizationError('nope'));
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(403);
  });

  it('operator disable → 200, update called, ORG_DISABLED audited under operator org', async () => {
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'org-x', isActive: false });
    expect(mockOrgUpdate).toHaveBeenCalledOnce();
    expect(mockCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'op-org',
        eventType: 'ORG_DISABLED',
        metadata: expect.objectContaining({ targetOrgId: 'org-x' }),
      })
    );
  });

  it('operator enable → 200, ORG_ENABLED', async () => {
    mockOrgUpdate.mockResolvedValue({ id: 'org-x', name: 'Org', slug: 'org-x', isActive: true });
    const res = await PATCH(makeRequest({ isActive: true }), params);
    expect(res.status).toBe(200);
    expect(mockCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ORG_ENABLED' })
    );
  });

  it('self-lockout: disabling an org the operator belongs to → 409, no write', async () => {
    mockUserOrgFindFirst.mockResolvedValue({ id: 'membership-1' });
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(409);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('protected org (keep-list) → 409, no write', async () => {
    mockOrgFindMany.mockResolvedValue([{ id: 'org-x' }]); // target is protected
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(409);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('missing protected-organization configuration fails closed before a write', async () => {
    delete process.env['PLATFORM_PROTECTED_ORG_SLUGS'];
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(503);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('org not found (update throws P2025) → 404', async () => {
    mockOrgUpdate.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(404);
  });

  it('audit write failure → 500 (audit is authoritative)', async () => {
    mockCaptureAudit.mockResolvedValue('failed');
    const res = await PATCH(makeRequest({ isActive: false }), params);
    expect(res.status).toBe(500);
  });
});
