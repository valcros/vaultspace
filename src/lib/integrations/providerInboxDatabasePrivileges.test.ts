import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { revokeAndVerifyProviderInboxAccess } from './providerInboxDatabasePrivileges';

function clientWith(access: Record<string, boolean>): PrismaClient {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
        has_column_privilege: false,
        is_owner: false,
        reachable_roles: [],
        ...access,
      },
    ]),
  } as unknown as PrismaClient;
}

describe('provider inbox application-role revocation', () => {
  it('passes only after every effective privilege is absent', async () => {
    const client = clientWith({});
    await expect(
      revokeAndVerifyProviderInboxAccess(client, 'vaultspace_app')
    ).resolves.toBeUndefined();
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'REVOKE ALL PRIVILEGES ON public.provider_event_inbox FROM vaultspace_app'
    );
  });

  it.each(['can_delete', 'has_column_privilege', 'is_owner'])(
    'fails closed while %s remains',
    async (privilege) => {
      await expect(
        revokeAndVerifyProviderInboxAccess(clientWith({ [privilege]: true }), 'vaultspace_app')
      ).rejects.toMatchObject({ code: 'PROVIDER_INBOX_APPLICATION_ROLE_ACCESS_REMAINS' });
    }
  );

  it('rejects memberships that could be reached with SET ROLE', async () => {
    const client = clientWith({});
    vi.mocked(client.$queryRawUnsafe).mockResolvedValue([
      {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
        has_column_privilege: false,
        is_owner: false,
        reachable_roles: ['vaultspace_support'],
      },
    ]);
    await expect(
      revokeAndVerifyProviderInboxAccess(client, 'vaultspace_app')
    ).rejects.toMatchObject({ code: 'PROVIDER_INBOX_APPLICATION_ROLE_ACCESS_REMAINS' });
  });

  it('propagates revoke failures instead of reporting success', async () => {
    const client = clientWith({});
    vi.mocked(client.$executeRawUnsafe).mockRejectedValue(new Error('permission denied'));
    await expect(revokeAndVerifyProviderInboxAccess(client, 'vaultspace_app')).rejects.toThrow(
      /permission denied/
    );
  });
});
