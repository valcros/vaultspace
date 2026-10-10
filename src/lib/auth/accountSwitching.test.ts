import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { SessionData } from '@/lib/auth';

const mocks = vi.hoisted(() => {
  const userFind = vi.fn();
  const linkFind = vi.fn();
  const linkFindFirst = vi.fn();
  const linkFindMany = vi.fn();
  const linkCount = vi.fn();
  const linkCreate = vi.fn();
  const linkDelete = vi.fn();
  const grantFind = vi.fn();
  const grantFindMany = vi.fn();
  const grantCreate = vi.fn();
  const grantUpdate = vi.fn();
  const grantUpdateMany = vi.fn();
  const tenantUpdateMany = vi.fn();
  const auditCreate = vi.fn();
  const cookieGet = vi.fn();
  const cookieSet = vi.fn();
  const cookieDelete = vi.fn();
  const candidate = vi.fn();
  const verifyPassword = vi.fn();
  const verifyTOTP = vi.fn();
  const createSession = vi.fn();
  const clearCache = vi.fn();
  const revokeSysop = vi.fn();
  const db = {
    user: { findUnique: userFind },
    accountLink: {
      findUnique: linkFind,
      findFirst: linkFindFirst,
      findMany: linkFindMany,
      count: linkCount,
      create: linkCreate,
      delete: linkDelete,
    },
    accountSwitchSession: {
      findUnique: grantFind,
      findMany: grantFindMany,
      create: grantCreate,
      update: grantUpdate,
      updateMany: grantUpdateMany,
    },
    platformAuditEvent: { create: auditCreate },
    session: { updateMany: tenantUpdateMany },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) =>
    callback(db)
  );
  return {
    db,
    userFind,
    linkFind,
    linkFindFirst,
    linkFindMany,
    linkCount,
    linkCreate,
    linkDelete,
    grantFind,
    grantFindMany,
    grantCreate,
    grantUpdate,
    grantUpdateMany,
    tenantUpdateMany,
    auditCreate,
    cookieGet,
    cookieSet,
    cookieDelete,
    candidate,
    verifyPassword,
    verifyTOTP,
    createSession,
    clearCache,
    revokeSysop,
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
  }),
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.42', 'user-agent': 'Test browser' }),
}));
vi.mock('@/lib/db', () => ({ bootstrapDb: mocks.db }));
vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  clearSessionCache: mocks.clearCache,
}));
vi.mock('@/lib/auth/bootstrapRepository', () => ({
  bootstrapRepository: { findLoginCandidate: mocks.candidate },
}));
vi.mock('@/lib/auth/password', () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock('@/lib/totp', () => ({ verifyTOTP: mocks.verifyTOTP }));
vi.mock('@/lib/sysop/platformSession', () => ({
  revokeSysopSessionsForTenantSession: mocks.revokeSysop,
  SYSOP_COOKIE_NAME: 'vaultspace-sysop',
}));

import {
  createAccountLink,
  getActiveSwitchSession,
  startAccountSwitching,
  switchAccount,
  SWITCH_COOKIE_NAME,
} from './accountSwitching';

const primary = {
  userId: 'primary-1',
  sessionId: 'tenant-primary-1',
  user: { email: 'primary@example.test' },
  organization: { name: 'Primary Org' },
} as SessionData;

const primaryRecord = {
  id: 'primary-1',
  email: 'primary@example.test',
  passwordHash: 'primary-hash',
  isActive: true,
  twoFactorEnabled: true,
  twoFactorSecret: 'primary-totp-secret',
};

function activeGrant() {
  return {
    id: 'grant-1',
    primaryUserId: 'primary-1',
    currentUserId: primary.userId,
    currentTenantSessionId: primary.sessionId,
    isActive: true,
    expiresAt: new Date(Date.now() + 20 * 60_000),
    lastActiveAt: new Date(),
    primaryMfaKeyHash: createHmac('sha256', 'test-account-switch-secret-with-sufficient-entropy')
      .update('vaultspace-account-switch-mfa:v1:')
      .update(primaryRecord.twoFactorSecret)
      .digest('hex'),
    ipSubnet: '203.0.113.0/24',
    userAgentHash: null,
  };
}

describe('verified account linking and switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['SESSION_SECRET'] = 'test-account-switch-secret-with-sufficient-entropy';
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.verifyTOTP.mockReturnValue(true);
    mocks.userFind.mockResolvedValue(primaryRecord);
    mocks.linkFind.mockResolvedValue(null);
    mocks.linkFindFirst.mockResolvedValue(null);
    mocks.linkFindMany.mockResolvedValue([]);
    mocks.linkCount.mockResolvedValue(1);
    mocks.linkCreate.mockResolvedValue({ id: 'link-1' });
    mocks.grantFindMany.mockResolvedValue([]);
    mocks.grantCreate.mockResolvedValue({ id: 'grant-1' });
    mocks.grantUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tenantUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.clearCache.mockResolvedValue(undefined);
    mocks.revokeSysop.mockResolvedValue(undefined);
    mocks.candidate.mockResolvedValue({
      userId: 'secondary-1',
      userIsActive: true,
      organizationId: 'secondary-org',
      organizationName: 'Secondary Org',
    });
    mocks.createSession.mockResolvedValue({
      session: { id: 'tenant-secondary-1', expiresAt: new Date(Date.now() + 86_400_000) },
      token: 'new-tenant-token',
    });
  });

  it('requires primary MFA and both account passwords before linking', async () => {
    mocks.verifyTOTP.mockReturnValue(false);
    await expect(
      createAccountLink(
        primary,
        {
          primaryPassword: 'primary-password',
          primaryCode: '123456',
          secondaryEmail: 'secondary@example.test',
          secondaryPassword: 'secondary-password',
        },
        'req-link'
      )
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ACCOUNT_SWITCH_DENIED' }),
    });
  });

  it('links a verified secondary without moving its roles or sessions', async () => {
    mocks.userFind.mockResolvedValueOnce(primaryRecord).mockResolvedValueOnce({
      id: 'secondary-1',
      email: 'secondary@example.test',
      passwordHash: 'secondary-hash',
      isActive: true,
      emailVerifiedAt: new Date(),
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });
    await expect(
      createAccountLink(
        primary,
        {
          primaryPassword: 'primary-password',
          primaryCode: '123456',
          secondaryEmail: 'secondary@example.test',
          secondaryPassword: 'secondary-password',
        },
        'req-link'
      )
    ).resolves.toEqual({ id: 'link-1', email: 'secondary@example.test' });
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(2);
    expect(mocks.linkCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        primaryUserId: 'primary-1',
        secondaryUserId: 'secondary-1',
      }),
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ACCOUNT_LINKED',
        actorUserId: 'primary-1',
        targetUserId: 'secondary-1',
      }),
    });
  });

  it('rejects opening a switching window from a secondary login', async () => {
    mocks.linkFind.mockResolvedValue({ id: 'link-1' });
    await expect(
      startAccountSwitching(primary, 'password', '123456', 'req-start')
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(mocks.grantCreate).not.toHaveBeenCalled();
  });

  it('opens a short switching window only after primary MFA', async () => {
    const expiresAt = await startAccountSwitching(primary, 'password', '123456', 'req-start');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mocks.grantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        primaryUserId: 'primary-1',
        currentUserId: 'primary-1',
        currentTenantSessionId: 'tenant-primary-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      SWITCH_COOKIE_NAME,
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ sameSite: 'strict', httpOnly: true })
    );
  });

  it('binds a switching window to the exact tenant session', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mocks.grantFind.mockResolvedValue(activeGrant());
    expect(await getActiveSwitchSession(primary)).toMatchObject({ id: 'grant-1' });
    expect(await getActiveSwitchSession({ ...primary, sessionId: 'different-login' })).toBeNull();
  });

  it('ends a switching window when the primary account loses MFA', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mocks.grantFind.mockResolvedValue(activeGrant());
    mocks.userFind.mockResolvedValue({ isActive: true, twoFactorEnabled: false });
    expect(await getActiveSwitchSession(primary)).toBeNull();
    expect(mocks.grantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ reasonCode: 'PRIMARY_MFA_REVOKED' }),
    });
  });

  it('does not revive an old switching window after an MFA reset and re-enrollment', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mocks.grantFind.mockResolvedValue(activeGrant());
    mocks.userFind.mockResolvedValue({
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: 'new-enrollment-secret',
    });
    expect(await getActiveSwitchSession(primary)).toBeNull();
    expect(mocks.grantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
  });

  it('switches only to a linked user, rotates the tenant session, and audits both identities', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mocks.grantFind.mockResolvedValue(activeGrant());
    mocks.userFind.mockImplementation(async ({ where }) =>
      where.id === 'primary-1'
        ? primaryRecord
        : { id: 'secondary-1', email: 'secondary@example.test', isActive: true }
    );
    mocks.linkFindFirst.mockResolvedValue({ id: 'link-1' });

    await expect(switchAccount(primary, 'secondary-1', 'req-switch')).resolves.toEqual({
      email: 'secondary@example.test',
      organizationName: 'Secondary Org',
    });
    expect(mocks.createSession).toHaveBeenCalledWith(
      'secondary-1',
      'secondary-org',
      expect.any(Object),
      mocks.db
    );
    expect(mocks.grantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentUserId: 'secondary-1',
          currentTenantSessionId: 'tenant-secondary-1',
        }),
      })
    );
    expect(mocks.tenantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'tenant-primary-1' }) })
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ACCOUNT_SWITCHED',
        actorUserId: 'primary-1',
        targetUserId: 'secondary-1',
        targetOrgId: 'secondary-org',
      }),
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'vaultspace-session',
      'new-tenant-token',
      expect.objectContaining({ httpOnly: true })
    );
    expect(mocks.cookieDelete).toHaveBeenCalledWith('vaultspace-sysop');
    expect(mocks.clearCache).toHaveBeenCalledWith(['tenant-primary-1']);
  });

  it('does not issue a new tenant session after unlink', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'x'.repeat(43) });
    mocks.grantFind.mockResolvedValue(activeGrant());
    mocks.userFind.mockImplementation(async ({ where }) =>
      where.id === 'primary-1'
        ? primaryRecord
        : { id: 'secondary-1', email: 'secondary@example.test', isActive: true }
    );
    await expect(switchAccount(primary, 'secondary-1', 'req-denied')).rejects.toMatchObject({
      name: 'AuthorizationError',
    });
    expect(mocks.userFind).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
