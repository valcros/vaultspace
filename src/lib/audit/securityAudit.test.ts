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

  it('uses insert-only conflict handling for an idempotent immutable event', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn();

    await expect(
      createSecurityAuditEvent({ event: { createMany, findUnique } } as never, {
        ...input,
        idempotencyKey: 'password-reset-flow-1-accepted-org-1',
      })
    ).resolves.toMatch(/^[0-9a-f-]{36}$/);

    expect(createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        idempotencyKey: 'password-reset-flow-1-accepted-org-1',
      }),
      skipDuplicates: true,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns the visible existing immutable event after an idempotency conflict', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ id: 'event-existing', organizationId: 'org-1' });

    await expect(
      createSecurityAuditEvent({ event: { createMany, findUnique } } as never, {
        ...input,
        idempotencyKey: 'password-reset-flow-1-accepted-org-1',
      })
    ).resolves.toBe('event-existing');
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
