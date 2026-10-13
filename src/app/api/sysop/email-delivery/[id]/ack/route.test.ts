import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { AuthenticationError, AuthorizationError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  capability: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/middleware', () => ({ requirePlatformOperator: mocks.guard }));
vi.mock('@/lib/sysop/capabilityGuard', () => ({ assertPlatformCapability: mocks.capability }));
vi.mock('@/lib/db', () => ({ bootstrapDb: { $transaction: mocks.transaction } }));

import { POST } from './route';

const id = '9e71ee6b-173c-40c5-b29b-48f09c3054dc';
const context = { params: Promise.resolve({ id }) };
function request(origin = 'https://vaultspace.test') {
  return new NextRequest(`https://vaultspace.test/api/sysop/email-delivery/${id}/ack`, {
    method: 'POST',
    headers: { origin },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['EMAIL_INCIDENT_VIEW_ENABLED'] = 'true';
  mocks.guard.mockResolvedValue({ userId: 'operator-1' });
  mocks.capability.mockResolvedValue(undefined);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      emailDeliveryIncident: { updateMany: mocks.updateMany },
      platformAuditEvent: { create: mocks.auditCreate },
    })
  );
});

describe('email delivery incident acknowledgement', () => {
  it('rejects a cross-origin mutation before database access', async () => {
    expect((await POST(request('https://attacker.test'), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('stays disabled until the incident view is activated', async () => {
    process.env['EMAIL_INCIDENT_VIEW_ENABLED'] = 'false';
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthenticationError(), 401],
    [new AuthorizationError('Forbidden'), 403],
  ])('rejects an unauthorized operator', async (error, status) => {
    mocks.guard.mockRejectedValue(error);
    expect((await POST(request(), context)).status).toBe(status);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires the security capability', async () => {
    mocks.capability.mockRejectedValue(new AuthorizationError('Capability required'));
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('acknowledges once and records a platform audit event atomically', async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://vaultspace.test/sysop/email-delivery');
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: expect.any(Date), acknowledgedByUserId: 'operator-1' },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EMAIL_DELIVERY_INCIDENT_ACKNOWLEDGED',
        actorUserId: 'operator-1',
        incidentRef: id,
        previousState: 'OPEN',
        nextState: 'ACKNOWLEDGED',
      }),
    });
  });

  it('does not write another audit event for an already acknowledged incident', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
