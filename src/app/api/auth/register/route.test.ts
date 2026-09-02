/**
 * Registration API Tests
 *
 * Covers the email-verification gate:
 *  - SELF-SERVICE (no invite): neutral 201 "verification_sent", NO session/org,
 *    a token is issued only for new or still-pending accounts (privacy-neutral).
 *  - INVITED: unchanged UX — creates a verified user, joins the org, signs in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { RateLimitError } from '@/lib/errors';

const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
const mockRegistrationByIp = vi.fn().mockResolvedValue(undefined);
const mockVerificationSendByEmail = vi.fn().mockResolvedValue(undefined);
const mockCreateVerificationToken = vi.fn(() => ({
  publicToken: 'evt1_' + 'a'.repeat(43),
  storedToken: 'evh1:' + 'b'.repeat(64),
}));
const mockSendVerificationEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
  rateLimiters: {
    registrationByIp: (ip: string) => mockRegistrationByIp(ip),
    emailVerificationResendByEmailFingerprint: (key: string) => mockVerificationSendByEmail(key),
  },
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

vi.mock('@/lib/auth/emailVerificationToken', () => ({
  createEmailVerificationToken: () => mockCreateVerificationToken(),
}));

vi.mock('@/lib/auth/emailVerificationDelivery', () => ({
  sendEmailVerificationEmail: (...a: unknown[]) => mockSendVerificationEmail(...a),
}));

const mockUserFindUnique = vi.fn();
const mockUserCreate = vi.fn();
const mockInvitationFindUnique = vi.fn();
const mockTokenCreate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn();
const mockCreateSession = vi.fn();
const mockPermissionCreateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockEventCreate = vi.fn().mockResolvedValue({});
const mockSetTransactionOrganizationContext = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => {
  const client = {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
    },
    invitation: { findUnique: (...args: unknown[]) => mockInvitationFindUnique(...args) },
    emailVerificationToken: { create: (...args: unknown[]) => mockTokenCreate(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return {
    db: client,
    bootstrapDb: client,
    setTransactionOrganizationContext: (...args: unknown[]) =>
      mockSetTransactionOrganizationContext(...args),
  };
});

vi.mock('@/lib/auth', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
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
  invitedByUserId: 'inviter-1',
  expiresAt: new Date(Date.now() + 86400000),
  organization: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
  roomAssignments: [{ roomId: 'room-1' }],
};

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrationByIp.mockResolvedValue(undefined);
    mockVerificationSendByEmail.mockResolvedValue(undefined);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({
      id: 'user-new',
      emailVerifiedAt: null,
      firstName: 'Alice',
    });
    mockTokenCreate.mockResolvedValue({});
    mockCreateVerificationToken.mockReturnValue({
      publicToken: 'evt1_' + 'a'.repeat(43),
      storedToken: 'evh1:' + 'b'.repeat(64),
    });
    mockCreateSession.mockResolvedValue({
      session: { id: 'auth-session-1' },
      token: 't'.repeat(43),
    });
    mockSetTransactionOrganizationContext.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          invitation: {
            findUnique: vi.fn().mockResolvedValue(pendingInvitation),
            update: vi.fn().mockResolvedValue({}),
          },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-1',
              email: 'alice@example.com',
              firstName: 'Alice',
              lastName: 'Smith',
            }),
          },
          userOrganization: { create: vi.fn().mockResolvedValue({}) },
          room: { findMany: vi.fn().mockResolvedValue([{ id: 'room-1' }]) },
          permission: { createMany: mockPermissionCreateMany },
          event: { create: mockEventCreate },
        };
        return fn(tx);
      }
    );
  });

  describe('Self-service (no invite) — email verification gate', () => {
    it('new email: neutral 201, NO session/org, token issued + email sent', async () => {
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ status: 'verification_sent' });
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockTokenCreate).toHaveBeenCalledOnce();
      expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
    });

    it('already-verified email: identical neutral 201, but NO token issued', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'existing',
        emailVerifiedAt: new Date(),
        firstName: 'Alice',
      });
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ status: 'verification_sent' });
      expect(mockTokenCreate).not.toHaveBeenCalled();
      expect(mockSendVerificationEmail).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('pending (unverified) email retrying: neutral 201 + fresh token (resend)', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'pending',
        emailVerifiedAt: null,
        firstName: 'Alice',
      });
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      expect(mockTokenCreate).toHaveBeenCalledOnce();
      expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
    });

    it('returns 429 when the per-IP registration limit is exceeded', async () => {
      mockRegistrationByIp.mockRejectedValue(new RateLimitError(60));
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(429);
      expect(mockUserCreate).not.toHaveBeenCalled();
    });

    it('concurrent create (P2002 unique race): re-reads and still returns neutral 201', async () => {
      // First lookup: not found -> attempt create. Create loses the race (P2002).
      // Re-read then finds the concurrently-created pending account.
      mockUserFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'raced', emailVerifiedAt: null, firstName: 'Alice' });
      mockUserCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ status: 'verification_sent' });
      // The re-read account is pending, so a token is still issued (resend semantics).
      expect(mockTokenCreate).toHaveBeenCalledOnce();
    });
  });

  describe('Invited path — unchanged UX, user stamped verified', () => {
    it('creates a verified user, joins the org, and signs in', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe('alice@example.com');
      expect(body.organization).toEqual({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      expect(mockCreateSession).toHaveBeenCalledWith(
        'user-1',
        'org-1',
        expect.objectContaining({ ipAddress: '127.0.0.1', userAgent: 'vitest' })
      );
      expect(mockPermissionCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            organizationId: 'org-1',
            roomId: 'room-1',
            userId: 'user-1',
            permissionLevel: 'VIEW',
            grantedByUserId: 'inviter-1',
          }),
        ],
      });
      expect(mockSetTransactionOrganizationContext).toHaveBeenCalledWith(
        expect.anything(),
        'org-1'
      );
      expect(mockEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'USER_ACCEPTED_INVITATION',
            metadata: { role: 'VIEWER', roomCount: 1, roomIds: ['room-1'] },
          }),
        })
      );
    });

    it('refuses a legacy viewer invitation with no persisted room assignment', async () => {
      mockInvitationFindUnique.mockResolvedValue({ ...pendingInvitation, roomAssignments: [] });

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/reissued with room access/i);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('keeps administrator invitations organization-wide', async () => {
      const administratorInvitation = {
        ...pendingInvitation,
        role: 'ADMIN',
        roomAssignments: [],
      };
      mockInvitationFindUnique.mockResolvedValue(administratorInvitation);
      mockTransaction.mockImplementationOnce(
        async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            invitation: {
              findUnique: vi.fn().mockResolvedValue(administratorInvitation),
              update: vi.fn().mockResolvedValue({}),
            },
            user: {
              create: vi.fn().mockResolvedValue({
                id: 'user-1',
                email: 'alice@example.com',
                firstName: 'Alice',
                lastName: 'Smith',
              }),
            },
            userOrganization: { create: vi.fn().mockResolvedValue({}) },
            room: { findMany: vi.fn().mockResolvedValue([]) },
            permission: { createMany: mockPermissionCreateMany },
            event: { create: mockEventCreate },
          };
          return fn(tx);
        }
      );

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));

      expect(res.status).toBe(200);
      expect(mockPermissionCreateMany).not.toHaveBeenCalled();
    });

    it('does not consume an invitation when an assigned room is no longer active', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      mockTransaction.mockImplementationOnce(
        async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            room: { findMany: vi.fn().mockResolvedValue([]) },
            invitation: {
              findUnique: vi.fn().mockResolvedValue(pendingInvitation),
              update: vi.fn().mockResolvedValue({}),
            },
            user: {
              create: vi.fn().mockResolvedValue({
                id: 'user-1',
                email: 'alice@example.com',
                firstName: 'Alice',
                lastName: 'Smith',
              }),
            },
            userOrganization: { create: vi.fn().mockResolvedValue({}) },
            permission: { createMany: vi.fn() },
            event: { create: vi.fn() },
          };
          return fn(tx);
        }
      );

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/no longer available/i);
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('returns 400 when email does not match invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      const res = await POST(
        makeRequest({ ...validBody, email: 'bob@example.com', inviteToken: 'valid-token' })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/does not match invitation/);
    });

    it('returns 400 for expired invitation', async () => {
      mockInvitationFindUnique.mockResolvedValue({
        ...pendingInvitation,
        expiresAt: new Date(Date.now() - 86400000),
      });
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/expired/);
    });

    it('returns 409 for an already-registered invited email', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      mockUserFindUnique.mockResolvedValue({ id: 'existing-user' });
      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));
      expect(res.status).toBe(409);
    });

    it('returns a controlled conflict for a concurrent account creation race', async () => {
      mockInvitationFindUnique.mockResolvedValue(pendingInvitation);
      mockTransaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

      const res = await POST(makeRequest({ ...validBody, inviteToken: 'valid-token' }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already exists|accepted/i);
    });
  });
});
