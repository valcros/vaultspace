import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '@/lib/auth';
import { generateTOTP, generateTOTPSecret } from '@/lib/totp';
import { hashUserAgent } from '@/lib/utils/ip';

const {
  mockCookieGet,
  mockCookieSet,
  mockCookieDelete,
  mockUserFind,
  mockUserUpdateMany,
  mockPlatformFind,
  mockPlatformFindMany,
  mockPlatformCreate,
  mockPlatformUpdateMany,
  mockAuditCreate,
  mockPolicy,
  mockDb,
} = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookieSet = vi.fn();
  const mockCookieDelete = vi.fn();
  const mockUserFind = vi.fn();
  const mockUserUpdateMany = vi.fn();
  const mockPlatformFind = vi.fn();
  const mockPlatformFindMany = vi.fn();
  const mockPlatformCreate = vi.fn();
  const mockPlatformUpdateMany = vi.fn();
  const mockAuditCreate = vi.fn();
  const mockPolicy = vi.fn();
  const mockDb = {
    user: { findUnique: mockUserFind, updateMany: mockUserUpdateMany },
    platformSession: {
      findUnique: mockPlatformFind,
      findMany: mockPlatformFindMany,
      create: mockPlatformCreate,
      updateMany: mockPlatformUpdateMany,
    },
    platformAuditEvent: { create: mockAuditCreate },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation((callback: (tx: typeof mockDb) => Promise<unknown>) =>
    callback(mockDb)
  );
  return {
    mockCookieGet,
    mockCookieSet,
    mockCookieDelete,
    mockUserFind,
    mockUserUpdateMany,
    mockPlatformFind,
    mockPlatformFindMany,
    mockPlatformCreate,
    mockPlatformUpdateMany,
    mockAuditCreate,
    mockPolicy,
    mockDb,
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookieGet, set: mockCookieSet, delete: mockCookieDelete }),
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.42', 'user-agent': 'VaultSpace test browser' }),
}));
vi.mock('@/lib/db', () => ({ bootstrapDb: mockDb }));
vi.mock('./ipAllowlist', () => ({
  SysopIpAllowlistService: { isClientIpAllowed: mockPolicy },
}));

import {
  enterSysopMode,
  exitSysopMode,
  getActiveSysopSession,
  SYSOP_COOKIE_NAME,
} from './platformSession';

const tenant = { userId: 'operator-1', sessionId: 'tenant-session-1' } as SessionData;

describe('temporary SysOp sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['SESSION_SECRET'] = 'test-secret-with-sufficient-entropy-for-hmac';
    mockPolicy.mockResolvedValue({ allowed: true });
    mockUserUpdateMany.mockResolvedValue({ count: 1 });
    mockPlatformUpdateMany.mockResolvedValue({ count: 1 });
    mockAuditCreate.mockResolvedValue({ id: 'audit-1' });
    mockPlatformFindMany.mockResolvedValue([]);
    mockUserFind.mockResolvedValue({
      isActive: true,
      isPlatformOperator: true,
      twoFactorEnabled: true,
      twoFactorSecret: generateTOTPSecret(),
    });
    mockPlatformCreate.mockImplementation(async ({ data }) => ({
      id: 'platform-1',
      ...data,
      isActive: true,
      lastActiveAt: new Date(),
    }));
  });

  it('issues a hashed, tenant-bound session only after fresh TOTP and audits entry', async () => {
    const user = await mockUserFind();
    mockUserFind.mockResolvedValue(user);
    const expiresAt = await enterSysopMode(
      tenant,
      generateTOTP(user.twoFactorSecret),
      'PLATFORM_MAINTENANCE',
      'req-entry'
    );

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const created = mockPlatformCreate.mock.calls[0]![0].data;
    expect(created.tenantSessionId).toBe(tenant.sessionId);
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockCookieSet).toHaveBeenCalledWith(
      SYSOP_COOKIE_NAME,
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' })
    );
    expect(created.tokenHash).not.toBe(mockCookieSet.mock.calls[0]![1]);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SYSOP_SESSION_STARTED',
        actorUserId: 'operator-1',
        platformSessionId: 'platform-1',
        authStrength: 'MFA',
      }),
    });
  });

  it('audits a rejected SysOp code without persisting the code or issuing a cookie', async () => {
    await expect(
      enterSysopMode(tenant, 'not-a-code', 'SUPPORT', 'req-denied')
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SYSOP_ACTION_DENIED',
        outcome: 'DENIED',
        reasonCode: 'MFA_INVALID',
      }),
    });
    expect(mockAuditCreate.mock.calls[0]![0].data).not.toHaveProperty('code');
    expect(mockPlatformCreate).not.toHaveBeenCalled();
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it('consumes a TOTP step once across repeated SysOp entries', async () => {
    const user = await mockUserFind();
    mockUserFind.mockResolvedValue(user);
    mockUserUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const code = generateTOTP(user.twoFactorSecret);
    await enterSysopMode(tenant, code, 'SUPPORT', 'req-first');
    await expect(enterSysopMode(tenant, code, 'SUPPORT', 'req-replay')).rejects.toMatchObject({
      name: 'AuthorizationError',
    });
    expect(mockPlatformCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ reasonCode: 'MFA_REPLAY_OR_STALE' }),
    });
  });

  it('rejects an otherwise valid platform cookie after the tenant session changes', async () => {
    mockCookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mockPlatformFind.mockResolvedValue({
      id: 'platform-1',
      userId: tenant.userId,
      tenantSessionId: tenant.sessionId,
      isActive: true,
      expiresAt: new Date(Date.now() + 100_000),
      lastActiveAt: new Date(),
      ipSubnet: '203.0.113.0/24',
      userAgentHash: hashUserAgent('VaultSpace test browser'),
    });
    expect(
      await getActiveSysopSession({ ...tenant, sessionId: 'another-tenant-session' })
    ).toBeNull();
  });

  it('does not allow a missing saved network binding to bypass the current network', async () => {
    mockCookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mockPlatformFind.mockResolvedValue({
      id: 'platform-1',
      userId: tenant.userId,
      tenantSessionId: tenant.sessionId,
      isActive: true,
      expiresAt: new Date(Date.now() + 100_000),
      lastActiveAt: new Date(),
      ipSubnet: null,
      userAgentHash: hashUserAgent('VaultSpace test browser'),
    });
    expect(await getActiveSysopSession(tenant)).toBeNull();
  });

  it('revokes and audits expiry before refusing access', async () => {
    mockCookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mockPlatformFind.mockResolvedValue({
      id: 'platform-1',
      userId: tenant.userId,
      tenantSessionId: tenant.sessionId,
      isActive: true,
      expiresAt: new Date(Date.now() + 100_000),
      lastActiveAt: new Date(Date.now() - 11 * 60_000),
      ipSubnet: '203.0.113.0/24',
      userAgentHash: hashUserAgent('VaultSpace test browser'),
    });
    expect(await getActiveSysopSession(tenant)).toBeNull();
    expect(mockPlatformUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SYSOP_SESSION_EXPIRED' }),
    });
  });

  it('revokes the bound session and audits explicit exit', async () => {
    mockPlatformFindMany.mockResolvedValue([{ id: 'platform-1' }]);
    await exitSysopMode(tenant, 'req-exit');
    expect(mockPlatformUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'platform-1', isActive: true } })
    );
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SYSOP_SESSION_ENDED', requestId: 'req-exit' }),
    });
    expect(mockCookieDelete).toHaveBeenCalledWith(SYSOP_COOKIE_NAME);
  });
});
