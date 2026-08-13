import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  PasswordResetCapabilityRepository,
  type PasswordResetCapabilityQueryClient,
} from './passwordResetCapabilityRepository';

const currentLookup = `prh1:${'a'.repeat(64)}`;
const legacyLookup = 'l'.repeat(43);
const passwordHash = `$2b$12$${'A'.repeat(53)}`;

function repositoryWithRows(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const repository = new PasswordResetCapabilityRepository({
    $queryRaw: queryRaw,
  } as unknown as PasswordResetCapabilityQueryClient);
  return { repository, queryRaw };
}

function redemptionRow(overrides: Record<string, unknown> = {}) {
  return {
    authorization_proven: true,
    flow_id: 'flow-1',
    subject_user_id: 'user-1',
    subject_email: 'user@example.test',
    initiation_request_id: 'request-1',
    audit_organization_ids: ['org-1', 'org-2'],
    audit_actor_types: ['ADMIN', 'VIEWER'],
    superseded_flow_ids: ['flow-2', 'flow-3'],
    superseded_request_ids: ['request-2', null],
    revoked_session_ids: ['session-1', 'session-2'],
    ...overrides,
  };
}

function queryParts(queryRaw: ReturnType<typeof vi.fn>) {
  return queryRaw.mock.calls[0]?.[0] as {
    strings?: string[];
    values?: unknown[];
  };
}

describe('PasswordResetCapabilityRepository', () => {
  it('parameterizes current and legacy candidate lookups and returns only a proof marker', async () => {
    for (const storedLookup of [currentLookup, legacyLookup]) {
      const { repository, queryRaw } = repositoryWithRows([{ candidate_proven: true }]);
      await expect(repository.candidateProven(storedLookup)).resolves.toBe(true);

      const query = queryParts(queryRaw);
      expect(query.values).toEqual([storedLookup]);
      expect(query.strings?.join('')).toContain(
        'FROM public.bootstrap_password_reset_candidate_v1(::text)'
      );
      expect(query.strings?.join('')).not.toContain(storedLookup);
    }
  });

  it('returns neutral candidate results for invalid inputs or no row', async () => {
    const invalid = repositoryWithRows([]);
    await expect(invalid.repository.candidateProven('prh1:wrong')).resolves.toBe(false);
    expect(invalid.queryRaw).not.toHaveBeenCalled();

    await expect(repositoryWithRows([]).repository.candidateProven(currentLookup)).resolves.toBe(
      false
    );
  });

  it('fails closed if candidate projection contains identity data or duplicate rows', async () => {
    await expect(
      repositoryWithRows([
        { candidate_proven: true, user_id: 'user-1' },
      ]).repository.candidateProven(currentLookup)
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_CANDIDATE_ENVELOPE_INVALID');

    await expect(
      repositoryWithRows([
        { candidate_proven: true },
        { candidate_proven: true },
      ]).repository.candidateProven(currentLookup)
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_CANDIDATE_ENVELOPE_INVALID');
  });

  it('parameterizes redemption and maps the typed audit and eviction envelope', async () => {
    const { repository, queryRaw } = repositoryWithRows([redemptionRow()]);

    await expect(repository.redeem(currentLookup, passwordHash)).resolves.toEqual({
      flowId: 'flow-1',
      subjectUserId: 'user-1',
      subjectEmail: 'user@example.test',
      initiationRequestId: 'request-1',
      auditOrganizations: [
        { organizationId: 'org-1', actorType: 'ADMIN' },
        { organizationId: 'org-2', actorType: 'VIEWER' },
      ],
      supersededFlows: [
        { flowId: 'flow-2', requestId: 'request-2' },
        { flowId: 'flow-3', requestId: null },
      ],
      revokedSessionIds: ['session-1', 'session-2'],
    });

    const query = queryParts(queryRaw);
    expect(query.values).toEqual([currentLookup, passwordHash]);
    expect(query.strings?.join('')).toContain('FROM public.bootstrap_password_reset_redeem_v1(');
    expect(query.strings?.join('')).not.toContain(currentLookup);
    expect(query.strings?.join('')).not.toContain(passwordHash);
  });

  it('rejects malformed lookup and bcrypt cost before querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);
    await expect(repository.redeem('bad', passwordHash)).resolves.toBeNull();
    await expect(repository.redeem(currentLookup, `$2b$11$${'A'.repeat(53)}`)).resolves.toBeNull();
    await expect(repository.redeem(currentLookup, 'plaintext-password')).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed on malformed, mismatched, duplicate, or broadened result envelopes', async () => {
    const invalidRows = [
      redemptionRow({ authorization_proven: false }),
      redemptionRow({ audit_organization_ids: [] }),
      redemptionRow({ audit_actor_types: ['ADMIN'] }),
      redemptionRow({ audit_actor_types: ['SYSTEM', 'VIEWER'] }),
      redemptionRow({ superseded_flow_ids: ['flow-2', 'flow-2'] }),
      redemptionRow({ superseded_request_ids: [] }),
      redemptionRow({ revoked_session_ids: ['session-2', 'session-1'] }),
      redemptionRow({ superseded_flow_ids: ['flow-1'], superseded_request_ids: [null] }),
      redemptionRow({ reset_token: legacyLookup }),
    ];

    for (const row of invalidRows) {
      await expect(
        repositoryWithRows([row]).repository.redeem(currentLookup, passwordHash)
      ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_REDEMPTION_ENVELOPE_INVALID');
    }

    await expect(
      repositoryWithRows([redemptionRow(), redemptionRow()]).repository.redeem(
        currentLookup,
        passwordHash
      )
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_REDEMPTION_DUPLICATE');
  });

  it('keeps the foundation unchanged and routes only the two bounded capabilities', () => {
    const foundationMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql'
      ),
      'utf8'
    );
    expect(foundationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bootstrap_password_reset_candidate_v1(text) FROM PUBLIC;'
    );
    expect(foundationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text) FROM PUBLIC;'
    );
    expect(foundationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bootstrap_password_reset_candidate_v1(text)\n      FROM vaultspace_app;'
    );
    expect(foundationMigration).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_password_reset_/i
    );
    expect(foundationMigration).not.toContain('DATABASE_URL_ADMIN');

    const routeMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260813220000_w1_2_password_reset_redemption_route_conversion/migration.sql'
      ),
      'utf8'
    );
    expect(routeMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bootstrap_password_reset_candidate_v1(text)'
    );
    expect(routeMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text)'
    );
    expect(routeMigration.match(/GRANT EXECUTE ON FUNCTION/g)).toHaveLength(2);
    expect(routeMigration).toContain('BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID');
    expect(routeMigration).toContain('BOOTSTRAP_RUNTIME_RESET_PRIVILEGES_CHANGED');
    expect(routeMigration).toContain('COLLATE pg_catalog."C"');
    expect(routeMigration).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.bootstrap_session_revoke_user_org_v1'
    );
    expect(routeMigration).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.bootstrap_session_revoke_user_global_v1'
    );
    expect(routeMigration).not.toContain('DATABASE_URL_ADMIN');

    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/reset-password/route.ts'),
      'utf8'
    );
    expect(route).toContain('passwordResetCapabilityRepository.candidateProven');
    expect(route).toContain('new PasswordResetCapabilityRepository(tx)');
    expect(route).toContain('db.$transaction');
    expect(route).toContain('setTransactionOrganizationContext');
    expect(route).toContain('clearSessionCache(redemption.revokedSessionIds)');
    expect(route).not.toContain('bootstrapDb');
    expect(route).not.toContain('withOrgContext');
    expect(route).not.toMatch(
      /(?:passwordResetToken|passwordResetRecovery|user|session)\.(?:find|update|create|delete)/
    );

    const repository = readFileSync(
      resolve(process.cwd(), 'src/lib/auth/passwordResetCapabilityRepository.ts'),
      'utf8'
    );
    expect(repository).not.toContain('bootstrapDb');
    expect(repository).not.toMatch(/input_(user|organization|flow|session|audit)/i);
  });
});
