/**
 * Admin-triggered Password Reset API tests
 *
 * POST /api/users/:userId/reset-password
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
  bootstrapDb: { passwordResetToken: { updateMany: vi.fn() } },
}));
vi.mock('@/providers', () => ({ getProviders: vi.fn() }));
vi.mock('@/lib/deployment-capabilities', () => ({ hasCapability: vi.fn() }));
vi.mock('@/workers/types', () => ({
  JOB_NAMES: { EMAIL_SEND: 'email.send' },
  QUEUE_NAMES: { NORMAL: 'normal' },
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext, bootstrapDb } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability } from '@/lib/deployment-capabilities';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);
const mockInvalidateToken = vi.mocked(bootstrapDb.passwordResetToken.updateMany);
const mockGetProviders = vi.mocked(getProviders);
const mockHasCapability = vi.mocked(hasCapability);
const mockAddJob = vi.fn();
const mockSendEmail = vi.fn();

type Session = ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never;

describe('POST /api/users/:userId/reset-password', () => {
  const adminSession = {
    userId: 'admin-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
    user: { email: 'admin@example.com' },
  };
  const OLD_APP_URL = process.env['APP_URL'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://app.example.com';
    mockRequireAuth.mockResolvedValue(adminSession as Session);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendAsyncEmail');
    mockGetProviders.mockReturnValue({
      job: { addJob: mockAddJob },
      email: { sendEmail: mockSendEmail },
    } as unknown as ReturnType<typeof getProviders>);
    mockAddJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env['APP_URL'] = OLD_APP_URL;
  });

  function resetTx(userOverride: Record<string, unknown> = {}, recentToken: unknown = null) {
    return {
      userOrganization: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'uo-2',
          userId: 'user-2',
          organizationId: 'org-1',
          isActive: true,
          user: {
            id: 'user-2',
            email: 'user@example.com',
            firstName: 'Existing',
            isActive: true,
            ...userOverride,
          },
        }),
      },
      passwordResetToken: {
        findFirst: vi.fn().mockResolvedValue(recentToken),
        create: vi.fn().mockResolvedValue({}),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'Acme',
          emailSenderName: 'Acme Data Room',
          emailSenderAddress: 'dataroom@acme.example',
        }),
      },
      event: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
  }
  const useTx = (tx: Record<string, unknown>) =>
    mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
      callback(tx as unknown as Parameters<typeof callback>[0])
    );
  const req = () =>
    new NextRequest('http://localhost/api/users/user-2/reset-password', { method: 'POST' });
  const ctx = { params: Promise.resolve({ userId: 'user-2' }) };

  it('returns 403 for non-admin callers', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
      user: { email: 'viewer@example.com' },
    } as Session);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 503 when no email capability, without minting a token', async () => {
    mockHasCapability.mockReturnValue(false);
    const tx = resetTx();
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(503);
    // withOrgContext is never entered — token/tx work is skipped entirely.
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the target is not a member of the org', async () => {
    useTx({ userOrganization: { findFirst: vi.fn().mockResolvedValue(null) } });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('refuses a globally deactivated account (400) without a token', async () => {
    const tx = resetTx({ isActive: false });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('refuses a deactivated MEMBERSHIP (400) even if the global account is active', async () => {
    const tx = resetTx();
    tx.userOrganization.findFirst = vi.fn().mockResolvedValue({
      id: 'uo-2',
      userId: 'user-2',
      organizationId: 'org-1',
      isActive: false, // membership disabled in this org
      user: { id: 'user-2', email: 'user@example.com', firstName: 'X', isActive: true },
    });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('enforces a cooldown (429) when a fresh token was just issued', async () => {
    const tx = resetTx({}, { id: 'recent-token' });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(429);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 502 and invalidates the undelivered token when the email cannot be queued', async () => {
    const tx = resetTx();
    useTx(tx);
    mockAddJob.mockRejectedValue(new Error('queue down'));
    mockInvalidateToken.mockResolvedValue({ count: 1 } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(502);
    // The token was minted before delivery was attempted...
    expect(tx.passwordResetToken.create).toHaveBeenCalled();
    // ...then neutralized so it can't linger and doesn't block a retry.
    expect(mockInvalidateToken).toHaveBeenCalledWith({
      where: { token: expect.any(String), usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('mints a token, audits USER_PASSWORD_RESET, and queues the email via the per-org sender', async () => {
    const tx = resetTx();
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);

    // A per-target row lock is taken before the cooldown check (atomic cooldown).
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.passwordResetToken.create).toHaveBeenCalledWith({
      data: { userId: 'user-2', token: expect.any(String), expiresAt: expect.any(Date) },
    });
    // Audit records the request but NEVER the token itself (metadata + text).
    const eventArg = (tx.event.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const createArg = (tx.passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const mintedToken = createArg?.data?.token as string;
    expect(mintedToken).toEqual(expect.any(String));
    expect(JSON.stringify(eventArg?.data)).not.toContain(mintedToken);
    expect(eventArg?.data?.metadata).toEqual({ targetUserId: 'user-2' });
    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'USER_PASSWORD_RESET',
          actorType: 'ADMIN',
        }),
      })
    );
    expect(mockAddJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({
        to: 'user@example.com',
        template: 'password-reset',
        from: 'dataroom@acme.example',
        fromName: 'Acme Data Room',
        data: expect.objectContaining({
          resetUrl: expect.stringContaining('/auth/reset-password?token='),
        }),
      })
    );
  });
});
