import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockLinkFindFirst = vi.fn();

vi.mock('@/lib/db', () => ({
  bootstrapDb: { link: { findFirst: (...args: unknown[]) => mockLinkFindFirst(...args) } },
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { LINK_ACCESS_DENIED: 60_000 },
  captureAccessAudit: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
}));

vi.mock('@/providers', () => ({ getProviders: vi.fn() }));

import { POST } from './route';

function makeContext() {
  return { params: Promise.resolve({ slug: 'share-link' }) };
}

describe('POST /api/links/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([{ email: 42 }, { email: 'not-an-email' }, { password: { nested: true } }])(
    'returns 400 before link lookup for malformed body %#',
    async (body) => {
      const response = await POST(
        new NextRequest('http://localhost/api/links/share-link', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        makeContext()
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid request' });
      expect(mockLinkFindFirst).not.toHaveBeenCalled();
    }
  );
});
