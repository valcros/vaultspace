import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithOrgContext = vi.fn();

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

import { captureSecurityAudit, createSecurityAuditEvent } from './securityAudit';

const input = {
  organizationId: 'org-1',
  eventType: 'USER_PASSWORD_RESET' as const,
  actorType: 'ADMIN' as const,
  actorId: 'user-1',
  actorEmail: 'User@Example.com',
  requestId: 'request-2',
  correlationId: 'flow-1',
  description: 'User completed a password reset',
  metadata: { outcome: 'success' },
  ipAddress: '192.0.2.10',
  userAgent: 'test-agent',
};

describe('securityAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an authoritative correlated event without consulting activity capture mode', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-1' });

    await expect(createSecurityAuditEvent({ event: { create } } as never, input)).resolves.toBe(
      'event-1'
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        correlationId: 'flow-1',
        actorEmail: 'user@example.com',
        metadata: expect.objectContaining({
          category: 'authentication',
          authoritative: true,
          schemaVersion: 1,
        }),
      }),
    });
  });

  it('keeps best-effort audit failure diagnostics free of actor and network data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWithOrgContext.mockRejectedValue(new Error('database unavailable'));

    await expect(captureSecurityAudit(input)).resolves.toBe('failed');

    const log = String(consoleError.mock.calls[0]?.[0]);
    expect(log).toContain('flow-1');
    expect(log).not.toContain('User@Example.com');
    expect(log).not.toContain('192.0.2.10');
    consoleError.mockRestore();
  });
});
