import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockInvitationFindUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    invitation: {
      findUnique: (...args: unknown[]) => mockInvitationFindUnique(...args),
    },
  },
}));

import { GET } from './route';

function makeContext(token = 'invite-token') {
  return { params: Promise.resolve({ token }) };
}

function makeInvitation(roomAssignmentCount: number) {
  return {
    email: 'viewer@example.com',
    role: 'VIEWER',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    organization: { name: 'Test Org', slug: 'test-org' },
    _count: { roomAssignments: roomAssignmentCount },
  };
}

describe('GET /api/invitations/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid viewer invitation only when it has a room assignment', async () => {
    mockInvitationFindUnique.mockResolvedValue(makeInvitation(1));

    const response = await GET(
      new NextRequest('http://localhost/api/invitations/invite-token'),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: 'viewer@example.com',
      role: 'VIEWER',
      organizationName: 'Test Org',
      roomCount: 1,
    });
  });

  it('asks an administrator to reissue a legacy viewer invitation without rooms', async () => {
    mockInvitationFindUnique.mockResolvedValue(makeInvitation(0));

    const response = await GET(
      new NextRequest('http://localhost/api/invitations/invite-token'),
      makeContext()
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/reissued with room access/i);
  });
});
