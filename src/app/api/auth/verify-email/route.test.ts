/**
 * Verify Email API Tests
 *
 * Covers the atomic single-use claim + deferred org creation + auto-login,
 * plus idempotent already-verified and invalid/expired handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolveStoredToken = vi.fn();
const mockCreateSession = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');

vi.mock('@/lib/auth/emailVerificationToken', () => ({
  resolveStoredToken: (...a: unknown[]) => mockResolveStoredToken(...a),
}));

vi.mock('@/lib/auth', () => ({
  createSession: (...a: unknown[]) => mockCreateSession(...a),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  captureAccessAudit: (...a: unknown[]) => mockCaptureAccessAudit(...a),
}));

const mockTransaction = vi.fn();
const mockSetTransactionOrganizationContext = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/db', () => {
  const client = { $transaction: (...a: unknown[]) => mockTransaction(...a) };
  return {
    db: client,
    bootstrapDb: client,
    setTransactionOrganizationContext: (...a: unknown[]) =>
      mockSetTransactionOrganizationContext(...a),
  };
});

import { POST } from './route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build a tx double with configurable claim count and user state. */
function buildTx(opts: { claimCount: number; tokenUserId: string | null; user: unknown }) {
  const orgCreate = vi.fn().mockResolvedValue({
    id: 'org-new',
    name: "Alice's Organization",
    slug: 'org-abc',
  });
  const membershipCreate = vi.fn().mockResolvedValue({});
  const roomCreate = vi.fn().mockResolvedValue({
    id: 'room-initial',
    name: 'My First Data Room',
    slug: 'my-first-data-room',
    status: 'DRAFT',
  });
  const eventCreate = vi.fn().mockResolvedValue({});
  const userUpdate = vi.fn().mockResolvedValue({});
  const tokenUpdateMany = vi.fn().mockResolvedValue({ count: opts.claimCount });
  const recoveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    tx: {
      $executeRaw: vi.fn().mockResolvedValue(0),
      emailVerificationToken: {
        updateMany: tokenUpdateMany,
        findFirst: vi
          .fn()
          .mockResolvedValue(opts.tokenUserId ? { userId: opts.tokenUserId } : null),
      },
      emailVerificationRecovery: { updateMany: recoveryUpdateMany },
      user: {
        findUnique: vi.fn().mockResolvedValue(opts.user),
        update: userUpdate,
      },
      organization: { create: orgCreate },
      userOrganization: { create: membershipCreate },
      room: { create: roomCreate },
      event: { create: eventCreate },
    },
    orgCreate,
    membershipCreate,
    roomCreate,
    eventCreate,
    userUpdate,
    tokenUpdateMany,
    recoveryUpdateMany,
  };
}

const validToken = 'evt1_' + 'a'.repeat(43);

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveStoredToken.mockReturnValue('evh1:' + 'b'.repeat(64));
    mockCreateSession.mockResolvedValue({
      session: { id: 'auth-session-1' },
      token: 't'.repeat(43),
    });
  });

  it('fresh claim: creates org + membership, verifies user, signs in (200 verified)', async () => {
    const built = buildTx({
      claimCount: 1,
      tokenUserId: 'user-1',
      user: {
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        emailVerifiedAt: null,
      },
    });
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(built.tx)
    );

    const res = await POST(makeRequest({ token: validToken }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('verified');
    expect(body.organization).toEqual({
      id: 'org-new',
      name: "Alice's Organization",
      slug: 'org-abc',
    });
    expect(built.orgCreate).toHaveBeenCalledOnce();
    expect(built.membershipCreate).toHaveBeenCalledOnce();
    expect(built.roomCreate).toHaveBeenCalledOnce();
    expect(built.eventCreate).toHaveBeenCalledOnce();
    expect(mockSetTransactionOrganizationContext).toHaveBeenCalledWith(built.tx, 'org-new');
    expect(body.room).toEqual({
      id: 'room-initial',
      name: 'My First Data Room',
      slug: 'my-first-data-room',
      status: 'DRAFT',
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(built.userUpdate).toHaveBeenCalledOnce();
    expect(built.tokenUpdateMany).toHaveBeenCalledTimes(2);
    expect(built.recoveryUpdateMany).toHaveBeenCalledOnce();
    expect(mockCreateSession).toHaveBeenCalledWith(
      'user-1',
      'org-new',
      expect.objectContaining({ ipAddress: '127.0.0.1' })
    );
  });

  it('already-verified user (claim did not land): 200 already_verified, no org, no session', async () => {
    const built = buildTx({
      claimCount: 0,
      tokenUserId: 'user-1',
      user: {
        id: 'user-1',
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        emailVerifiedAt: new Date(),
      },
    });
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(built.tx)
    );

    const res = await POST(makeRequest({ token: validToken }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('already_verified');
    expect(built.orgCreate).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('expired/used token with unverified user: 400', async () => {
    const built = buildTx({
      claimCount: 0,
      tokenUserId: 'user-1',
      user: {
        id: 'user-1',
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        emailVerifiedAt: null,
      },
    });
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(built.tx)
    );

    const res = await POST(makeRequest({ token: validToken }));
    expect(res.status).toBe(400);
    expect(built.orgCreate).not.toHaveBeenCalled();
  });

  it('malformed token: 400 without touching the database', async () => {
    mockResolveStoredToken.mockReturnValue(null);
    const res = await POST(makeRequest({ token: 'garbage' }));
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
