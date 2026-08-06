import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithOrgContext = vi.fn();

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

import { ACCESS_AUDIT_DEDUPE_MS, captureAccessAudit } from './accessAudit';

const baseInput = {
  organizationId: 'org-1',
  eventType: 'DOCUMENT_VIEWED' as const,
  actorType: 'VIEWER' as const,
  actorEmail: 'Asserted@Example.com',
  roomId: 'room-1',
  documentId: 'doc-1',
  viewSessionId: 'viewer-session-1',
  requestId: 'request-1',
  description: 'Document opened through a share link',
  ipAddress: '192.0.2.10',
  userAgent: 'test-agent',
};

describe('captureAccessAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the organization mode is OFF', async () => {
    const eventCreate = vi.fn();
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'OFF' }) },
        event: { findFirst: vi.fn(), create: eventCreate },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(captureAccessAudit(baseInput)).resolves.toBe('disabled');
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('captures a non-authoritative event in SHADOW mode', async () => {
    const eventCreate = vi.fn().mockResolvedValue({ id: 'event-1' });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
        event: { findFirst: vi.fn().mockResolvedValue(null), create: eventCreate },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(
      captureAccessAudit({
        ...baseInput,
        dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.DOCUMENT_VIEWED,
      })
    ).resolves.toBe('captured');

    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorEmail: 'asserted@example.com',
        eventType: 'DOCUMENT_VIEWED',
        sessionId: 'viewer-session-1',
        metadata: expect.objectContaining({
          source: 'native',
          auditCaptureMode: 'SHADOW',
          authoritative: false,
        }),
      }),
    });
  });

  it('marks events authoritative only in AUTHORITATIVE mode', async () => {
    const eventCreate = vi.fn().mockResolvedValue({ id: 'event-1' });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: {
          findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'AUTHORITATIVE' }),
        },
        event: { findFirst: vi.fn(), create: eventCreate },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(captureAccessAudit(baseInput)).resolves.toBe('captured');
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ authoritative: true }),
      }),
    });
  });

  it('deduplicates repeated document opens for the same viewer session', async () => {
    const eventCreate = vi.fn();
    const eventFindFirst = vi.fn().mockResolvedValue({ id: 'existing-event' });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
        event: { findFirst: eventFindFirst, create: eventCreate },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(
      captureAccessAudit({
        ...baseInput,
        dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.DOCUMENT_VIEWED,
      })
    ).resolves.toBe('deduplicated');

    expect(eventFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        eventType: 'DOCUMENT_VIEWED',
        sessionId: 'viewer-session-1',
      }),
      select: { id: true },
    });
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('rate-limits denied link events by IP without logging request data', async () => {
    const eventFindFirst = vi.fn().mockResolvedValue({ id: 'existing-event' });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
        event: { findFirst: eventFindFirst, create: vi.fn() },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(
      captureAccessAudit({
        ...baseInput,
        eventType: 'LINK_ACCESS_DENIED',
        description: 'Share-link access denied',
        metadata: { reason: 'PASSWORD_INVALID' },
        dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.LINK_ACCESS_DENIED,
        dedupeByIp: true,
      })
    ).resolves.toBe('deduplicated');

    expect(eventFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ipAddress: '192.0.2.10',
        metadata: { path: ['reason'], equals: 'PASSWORD_INVALID' },
      }),
      select: { id: true },
    });
  });

  it('normalizes asserted email in the dedupe lookup', async () => {
    const eventFindFirst = vi.fn().mockResolvedValue({ id: 'existing-event' });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
        event: { findFirst: eventFindFirst, create: vi.fn() },
        viewSession: { updateMany: vi.fn() },
      })
    );

    await expect(
      captureAccessAudit({
        ...baseInput,
        viewSessionId: null,
        actorEmail: '  Asserted@Example.com  ',
        dedupeWindowMs: ACCESS_AUDIT_DEDUPE_MS.DOCUMENT_VIEWED,
      })
    ).resolves.toBe('deduplicated');

    expect(eventFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ actorEmail: 'asserted@example.com' }),
      select: { id: true },
    });
  });

  it('swallows database failures and returns failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWithOrgContext.mockRejectedValue(new Error('database unavailable'));

    await expect(captureAccessAudit(baseInput)).resolves.toBe('failed');
    expect(consoleError).toHaveBeenCalledOnce();
    const log = String(consoleError.mock.calls[0]?.[0]);
    expect(log).not.toContain(baseInput.actorEmail);
    expect(log).not.toContain(baseInput.ipAddress);
    expect(log).not.toContain(baseInput.documentId);
    consoleError.mockRestore();
  });

  it('refreshes viewer activity independently of audit mode', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mockWithOrgContext.mockImplementation(async (_orgId, operation) =>
      operation({
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'OFF' }) },
        event: { findFirst: vi.fn(), create: vi.fn() },
        viewSession: { updateMany },
      })
    );

    await expect(captureAccessAudit({ ...baseInput, touchViewerActivity: true })).resolves.toBe(
      'disabled'
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'viewer-session-1',
        organizationId: 'org-1',
        isActive: true,
      }),
      data: { lastActivityAt: expect.any(Date) },
    });
  });
});
