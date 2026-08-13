import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { setTransactionOrganizationContext } from './db';

describe('setTransactionOrganizationContext', () => {
  it('parameterizes a transaction-local organization context without opening another transaction', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const organizationId = "org-hostile'); SELECT pg_sleep(10); --";

    await setTransactionOrganizationContext(
      { $executeRaw: executeRaw } as unknown as Pick<Prisma.TransactionClient, '$executeRaw'>,
      organizationId
    );

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const template = executeRaw.mock.calls[0]?.[0] as string[];
    expect(template.join('<value>')).toBe("SELECT set_config('app.current_org_id', <value>, true)");
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([organizationId]);
  });
});
