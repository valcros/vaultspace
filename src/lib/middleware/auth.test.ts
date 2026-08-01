import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { getRequestContext } from './auth';

describe('getRequestContext request id validation', () => {
  it('preserves a bounded safe upstream request id', () => {
    const request = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'gateway:request-123' },
    });

    expect(getRequestContext(request).requestId).toBe('gateway:request-123');
  });

  it('replaces an oversized or unsafe request id before database use', () => {
    const oversized = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'x'.repeat(101) },
    });
    const unsafe = new NextRequest('https://vaultspace.example.com/api/test', {
      headers: { 'x-request-id': 'request with spaces' },
    });

    expect(getRequestContext(oversized).requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(getRequestContext(unsafe).requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });
});
