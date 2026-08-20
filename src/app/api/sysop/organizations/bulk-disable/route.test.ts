/**
 * SysOp bulk-disable tests: dry-run vs execute, keep-list + operator-org safety,
 * confirmIds∩eligible TOCTOU closure, behavioral authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { AuthenticationError, AuthorizationError } from '@/lib/errors';

const mockRequireOperator = vi.fn();
const mockCaptureAudit = vi.fn().mockResolvedValue('captured');
const mockOrgUpdate = vi.fn();
const mockOrgFindMany = vi.fn();
const mockUserOrgFindMany = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requirePlatformOperator: () => mockRequireOperator(),
  getRequestContext: () => ({ requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}));
vi.mock('@/lib/audit/securityAudit', () => ({
  captureSecurityAudit: (input: unknown) => mockCaptureAudit(input),
}));
vi.mock('@/lib/db', () => {
  const client = {
    organization: {
      findMany: (...a: unknown[]) => mockOrgFindMany(...a),
      update: (...a: unknown[]) => mockOrgUpdate(...a),
    },
    userOrganization: { findMany: (...a: unknown[]) => mockUserOrgFindMany(...a) },
  };
  return { db: client, bootstrapDb: client };
});

import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sysop/organizations/bulk-disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const operatorSession = { userId: 'op-1', organizationId: 'op-org', user: { email: 'op@x.com' } };

// Candidates the classifier returns (0 rooms). Includes a keep-list org and the
// operator's org that must be EXCLUDED, plus real junk.
const candidates = [
  { id: 'junk-1', name: 'gibberish', slug: 'org-1-a', _count: { users: 1 } },
  { id: 'junk-2', name: 'gibberish2', slug: 'org-2-b', _count: { users: 1 } },
  { id: 'keep-brightside', name: 'Brightside', slug: 'brightside', _count: { users: 1 } },
  { id: 'op-org', name: 'Operator Org', slug: 'op-org-slug', _count: { users: 1 } },
  { id: 'too-many-users', name: 'Has members', slug: 'org-3-c', _count: { users: 5 } },
];

describe('POST /api/sysop/organizations/bulk-disable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOperator.mockResolvedValue(operatorSession);
    // keep-list resolves brightside by slug; operator membership adds op-org.
    mockOrgFindMany.mockImplementation((args: { where?: { slug?: unknown } }) => {
      if (args?.where && 'slug' in args.where) {
        return Promise.resolve([{ id: 'keep-brightside' }]);
      }
      return Promise.resolve(candidates);
    });
    mockUserOrgFindMany.mockResolvedValue([{ organizationId: 'op-org' }]);
    mockOrgUpdate.mockResolvedValue({ slug: 'org-1-a', name: 'gibberish' });
  });

  it('unauthenticated → 401', async () => {
    mockRequireOperator.mockRejectedValue(new AuthenticationError());
    const res = await POST(makeRequest({ dryRun: true }));
    expect(res.status).toBe(401);
  });

  it('non-operator → 403', async () => {
    mockRequireOperator.mockRejectedValue(new AuthorizationError('nope'));
    const res = await POST(makeRequest({ dryRun: true }));
    expect(res.status).toBe(403);
  });

  it('dry-run lists only real junk; keep-list + operator org + multi-user EXCLUDED; no writes', async () => {
    const res = await POST(makeRequest({ dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.organizations.map((o: { id: string }) => o.id);
    expect(ids).toEqual(['junk-1', 'junk-2']);
    expect(ids).not.toContain('keep-brightside');
    expect(ids).not.toContain('op-org');
    expect(ids).not.toContain('too-many-users');
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('execute without confirmIds → 400', async () => {
    const res = await POST(makeRequest({ dryRun: false }));
    expect(res.status).toBe(400);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it('execute disables only confirmIds ∩ eligible; skips the rest', async () => {
    // Operator submits junk-1 (eligible), keep-brightside (NOT eligible), and a stale id.
    const res = await POST(
      makeRequest({ dryRun: false, confirmIds: ['junk-1', 'keep-brightside', 'stale-id'] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disabled).toEqual(['junk-1']);
    expect(body.skipped).toEqual(expect.arrayContaining(['keep-brightside', 'stale-id']));
    expect(mockOrgUpdate).toHaveBeenCalledOnce(); // only junk-1 written
    expect(mockCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ORG_DISABLED', organizationId: 'op-org' })
    );
  });
});
