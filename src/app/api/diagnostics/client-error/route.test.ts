import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockRateLimit = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  getRequestContext: vi.fn(() => ({
    requestId: 'req-client-error',
    ipAddress: '192.0.2.10',
    userAgent: 'test-agent',
  })),
  rateLimiters: {
    clientDiagnosticsByUser: (...args: unknown[]) => mockRateLimit(...args),
  },
}));

import { AuthenticationError } from '@/lib/errors';
import { POST } from './route';

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('https://vaultspace.example.com/api/diagnostics/client-error', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://vaultspace.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/diagnostics/client-error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      sessionId: 'session-1',
    });
    mockRateLimit.mockResolvedValue(undefined);
  });

  it('logs only the allowlisted authenticated diagnostic fields', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(
      request({
        pathname: '/dashboard',
        errorName: 'ChunkLoadError',
        digest: 'digest-1',
        clientRelease: 'release-1',
      })
    );

    expect(response.status).toBe(204);
    expect(consoleError).toHaveBeenCalledOnce();
    const log = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
    expect(log).toMatchObject({
      requestId: 'req-client-error',
      userId: 'user-1',
      organizationId: 'org-1',
      pathname: '/dashboard',
      errorName: 'ChunkLoadError',
    });
    expect(log).not.toHaveProperty('stack');
    consoleError.mockRestore();
  });

  it('rejects paths containing query strings so reset tokens cannot be ingested', async () => {
    const response = await POST(
      request({ pathname: '/auth/reset-password?token=secret', errorName: 'Error' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated and cross-origin reports', async () => {
    mockRequireAuth.mockRejectedValueOnce(new AuthenticationError());
    expect(await POST(request({ pathname: '/dashboard', errorName: 'Error' }))).toHaveProperty(
      'status',
      401
    );

    const crossOrigin = request(
      { pathname: '/dashboard', errorName: 'Error' },
      { Origin: 'https://attacker.example.com' }
    );
    expect(await POST(crossOrigin)).toHaveProperty('status', 403);
  });

  it('rejects an oversized body even when Content-Length is absent or deceptive', async () => {
    const oversized = { pathname: `/${'x'.repeat(5000)}`, errorName: 'Error' };

    expect(await POST(request(oversized))).toHaveProperty('status', 413);
    expect(await POST(request(oversized, { 'Content-Length': '1' }))).toHaveProperty('status', 413);
  });

  it('rejects malformed or oversized declared Content-Length values', async () => {
    const body = { pathname: '/dashboard', errorName: 'Error' };

    expect(await POST(request(body, { 'Content-Length': 'invalid' }))).toHaveProperty(
      'status',
      400
    );
    expect(await POST(request(body, { 'Content-Length': '4097' }))).toHaveProperty('status', 413);
  });
});
