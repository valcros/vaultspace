/**
 * Resend Verification API Tests
 *
 * Privacy-neutral: identical response for pending / verified / unknown emails.
 * A fresh token is issued only for a pending (unverified) account, and prior
 * valid links are never invalidated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { RateLimitError } from '@/lib/errors';

const mockResendByEmail = vi.fn().mockResolvedValue(undefined);
const mockResendByIp = vi.fn().mockResolvedValue(undefined);
const mockCreateVerificationToken = vi.fn(() => ({
  publicToken: 'evt1_' + 'a'.repeat(43),
  storedToken: 'evh1:' + 'b'.repeat(64),
}));
const mockSendVerificationEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  rateLimiters: {
    emailVerificationResendByEmailFingerprint: (key: string) => mockResendByEmail(key),
    emailVerificationResendByIp: (ip: string) => mockResendByIp(ip),
  },
}));

vi.mock('@/lib/auth/emailVerificationToken', () => ({
  createEmailVerificationToken: () => mockCreateVerificationToken(),
}));

vi.mock('@/lib/auth/emailVerificationDelivery', () => ({
  sendEmailVerificationEmail: (...a: unknown[]) => mockSendVerificationEmail(...a),
}));

const mockUserFindUnique = vi.fn();
const mockTokenCreate = vi.fn().mockResolvedValue({});
vi.mock('@/lib/db', () => {
  const client = {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    emailVerificationToken: { create: (...a: unknown[]) => mockTokenCreate(...a) },
  };
  return { db: client, bootstrapDb: client };
});

import { POST } from './route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockResendByEmail.mockResolvedValue(undefined);
    mockResendByIp.mockResolvedValue(undefined);
    mockTokenCreate.mockResolvedValue({});
    mockCreateVerificationToken.mockReturnValue({
      publicToken: 'evt1_' + 'a'.repeat(43),
      storedToken: 'evh1:' + 'b'.repeat(64),
    });
  });

  it('pending (unverified) account: 200 + fresh token + email sent', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u1', firstName: 'Alice', emailVerifiedAt: null });
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'verification_sent' });
    expect(mockTokenCreate).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
  });

  it('already-verified account: identical 200, but NO token issued', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'u1',
      firstName: 'Alice',
      emailVerifiedAt: new Date(),
    });
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'verification_sent' });
    expect(mockTokenCreate).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('unknown email: identical 200, no token', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: 'nobody@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'verification_sent' });
    expect(mockTokenCreate).not.toHaveBeenCalled();
  });

  it('rate limited: 429', async () => {
    mockResendByEmail.mockRejectedValue(new RateLimitError(60));
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(mockTokenCreate).not.toHaveBeenCalled();
  });
});
