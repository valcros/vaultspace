/**
 * Rooms API — RBAC contract (SEC).
 *
 * Creating a room is an ORG-level admin action. This locks the contract that a
 * VIEWER is rejected server-side (403) regardless of any UI gating, so the
 * "viewer sees admin controls" class of bug cannot become a data-integrity bug.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';

vi.mock('@/lib/middleware', () => ({
  requireAuthFromRequest: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

import { requireAuthFromRequest } from '@/lib/middleware';

const mockRequireAuth = vi.mocked(requireAuthFromRequest);

type SessionShape = Awaited<ReturnType<typeof requireAuthFromRequest>>;

function session(role: 'ADMIN' | 'VIEWER'): SessionShape {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role },
  } as unknown as SessionShape;
}

describe('POST /api/rooms (create room) — RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a VIEWER with 403 (create room is admin-only)', async () => {
    mockRequireAuth.mockResolvedValue(session('VIEWER'));

    const request = new NextRequest('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Room' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('does not deny an ADMIN at the role gate', async () => {
    mockRequireAuth.mockResolvedValue(session('ADMIN'));

    const request = new NextRequest('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Room' }),
    });

    // The org-admin passes the role gate; whatever happens downstream, it must
    // not be the 403 the gate produces for non-admins.
    const response = await POST(request);
    expect(response.status).not.toBe(403);
  });
});
