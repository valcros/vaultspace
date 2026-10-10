import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '@/lib/auth';

const mocks = vi.hoisted(() => ({
  grantFind: vi.fn(),
  grantList: vi.fn(),
  auditCreate: vi.fn(),
  activeMode: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    platformCapabilityGrant: {
      findFirst: mocks.grantFind,
      findMany: mocks.grantList,
    },
    platformAuditEvent: { create: mocks.auditCreate },
  },
}));
vi.mock('@/lib/sysop/platformSession', () => ({
  getActiveSysopSession: mocks.activeMode,
}));

import { assertPlatformCapability, listUsablePlatformCapabilities } from './capabilityGuard';

const originalFlag = process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'];
const session = { userId: 'operator-1', sessionId: 'tenant-1' } as SessionData;

beforeEach(() => {
  vi.clearAllMocks();
  process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] = 'true';
  mocks.activeMode.mockResolvedValue({ id: 'mode-1' });
  mocks.grantFind.mockResolvedValue({ id: 'grant-1' });
  mocks.grantList.mockResolvedValue([{ capability: 'SYSOP_CONSOLE_ACCESS' }]);
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
});

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'];
  } else {
    process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] = originalFlag;
  }
});

describe('platform capability gate', () => {
  it('does not query grants before capability rollout', async () => {
    process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] = 'false';
    await expect(
      assertPlatformCapability(session, 'SYSOP_SECURITY_MANAGE')
    ).resolves.toBeUndefined();
    expect(mocks.grantFind).not.toHaveBeenCalled();
    expect(mocks.activeMode).not.toHaveBeenCalled();
  });

  it('allows the exact active grant with an active MFA-backed SysOp mode', async () => {
    await expect(
      assertPlatformCapability(session, 'SYSOP_SECURITY_MANAGE')
    ).resolves.toBeUndefined();
    expect(mocks.grantFind).toHaveBeenCalledWith({
      where: { userId: 'operator-1', capability: 'SYSOP_SECURITY_MANAGE', revokedAt: null },
      select: { id: true },
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('denies and audits a missing grant', async () => {
    mocks.grantFind.mockResolvedValue(null);
    await expect(assertPlatformCapability(session, 'SYSOP_SECURITY_MANAGE')).rejects.toMatchObject({
      name: 'AuthorizationError',
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SYSOP_ACTION_DENIED',
        reasonCode: 'CAPABILITY_MISSING',
        changedFields: ['operator.capability'],
        correlationId: 'SYSOP_SECURITY_MANAGE',
      }),
    });
  });

  it('denies a grant when the temporary SysOp mode has ended', async () => {
    mocks.activeMode.mockResolvedValue(null);
    await expect(assertPlatformCapability(session, 'SYSOP_SECURITY_MANAGE')).rejects.toMatchObject({
      name: 'AuthorizationError',
      message: 'SysOp mode required',
    });
  });

  it('lists only unrevoked capabilities for navigation', async () => {
    const capabilities = await listUsablePlatformCapabilities(session);
    expect([...capabilities]).toEqual(['SYSOP_CONSOLE_ACCESS']);
    expect(mocks.grantList).toHaveBeenCalledWith({
      where: { userId: 'operator-1', revokedAt: null },
      select: { capability: true },
    });
  });
});
