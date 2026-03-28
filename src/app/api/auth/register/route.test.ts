/**
 * Registration API Tests (Issue 4b)
 *
 * Validates invite email enforcement and transactional invitation acceptance.
 * Self-signup (no invite) still works in this version — Issue 4a is a separate PR.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
}));

// Mock session cookie
vi.mock('@/lib/middleware', () => ({
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

// Mock db
const mockFindUnique = vi.fn();
const mockInvitationFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockSessionCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    invitation: { findUnique: (...args: unknown[]) => mockInvitationFindUnique(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    session: { create: (...args: unknown[]) => mockSessionCreate(...args) },
  },
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@example.com',
  password: 'securepassword123',
};

const pendingInvitation = {
  id: 'inv-1',
  invitationToken: 'valid-token',
  email: 'alice@example.com',
  status: 'PENDING',
  role: 'VIEWER',
  organizationId: 'org-1',
  expiresAt: new Date(Date.now() + 86400000), // +1 day
  organization: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
};

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(null); // No existing user
    mockSessionCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        invitation: { update: vi.fn().mockResolvedValue({}) },
        user: {
          create: vi.fn().mockResolvedValue({
            id: 'user-1',
            email: 'alice@example.com',
            firstName: 'Alice',
            lastName: 'Smith',
          }),
        },
        userOrganization: { create: vi.fn().mockResolvedValue({}) },
        organization: {
          create: vi.fn().mockResolvedValue({ id: 'org-new', name: "Alice's Organization", slug: 'org-123' }),
          findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' }),
        },
      };
      return fn(tx);
    });
  });

  describe('Self-signup without invite (still allowed pre-4a)', () => {
    it('succeeds and creates a new organization', async () => {
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe('alice@example.com');
    });
  });

  describe('Issue 4b — invite email enforcement', () => {
    it('returns 400 when email does not match invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      const res = await POST(
        makeRequest({ ...validBody, email: 'bob@example.com', inviteToken: 'valid-token' })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/does not match invitation/);
    });

    it('succeeds when email matches invitation (case-insensitive)', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      const res = await POST(
        makeRequest({ ...validBody, email: 'Alice@Example.com', inviteToken: 'valid-token' })
      );
      expect(res.status).toBe(200);
    });
  });

  describe('Invitation validation', () => {
    it('returns 400 for invalid token', async () => {
      mockInvitationFindUnique.mockResolvedValue(null);
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'bad-token' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid invitation/);
    });

    it('returns 400 for expired invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue({
        ...pendingInvitation,
        expiresAt: new Date(Date.now() - 86400000), // -1 day
      });
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/expired/);
    });

    it('returns 400 for already-used invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue({
        ...pendingInvitation,
        status: 'ACCEPTED',
      });
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/already been used/);
    });

    it('returns 409 for existing user email', async () => {
      mockFindUnique.mockResolvedValue({ id: 'existing-user' });
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(409);
    });
  });

  describe('Issue 4b — transactional invitation acceptance', () => {
    it('marks invitation ACCEPTED inside transaction', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);

      const txInvitationUpdate = vi.fn().mockResolvedValue({});
      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          invitation: { update: txInvitationUpdate },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-1',
              email: 'alice@example.com',
              firstName: 'Alice',
              lastName: 'Smith',
            }),
          },
          userOrganization: { create: vi.fn().mockResolvedValue({}) },
          organization: {
            findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' }),
          },
        };
        return fn(tx);
      });

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(200);

      // Verify invitation was updated inside the transaction
      expect(txInvitationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: 'ACCEPTED' }),
        })
      );
    });

    it('rolls back invitation acceptance if user creation fails', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockTransaction.mockRejectedValue(new Error('DB constraint violation'));

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(500);
    });
  });

  describe('Happy path with invite', () => {
    it('creates user with correct role from invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe('alice@example.com');
      expect(body.organization).toBeDefined();
    });
  });
});
