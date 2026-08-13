import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  SessionMutationRepository,
  type SessionMutationQueryClient,
} from './sessionMutationRepository';

function repositoryWithRows(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const repository = new SessionMutationRepository({
    $queryRaw: queryRaw,
  } as unknown as SessionMutationQueryClient);
  return { repository, queryRaw };
}

function queryParts(queryRaw: ReturnType<typeof vi.fn>) {
  return queryRaw.mock.calls[0]?.[0] as {
    strings?: string[];
    values?: unknown[];
  };
}

describe('SessionMutationRepository', () => {
  const token = 's'.repeat(43);
  const expiresAt = new Date('2026-08-13T00:00:00.000Z');

  it('parameterizes session creation and maps only the minimal projection', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      {
        session_id: '00000000-0000-4000-8000-000000000001',
        session_created_at: '2026-08-12T00:00:00.000Z',
        session_expires_at: '2026-08-13T00:00:00.000Z',
      },
    ]);

    await expect(
      repository.createSession({
        userId: 'user-1',
        organizationId: 'org-1',
        token,
        expiresAt,
        ipAddress: '192.0.2.10',
        userAgent: 'unit-test-agent',
      })
    ).resolves.toEqual({
      sessionId: '00000000-0000-4000-8000-000000000001',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      expiresAt,
    });

    const query = queryParts(queryRaw);
    expect(query.values).toEqual([
      'user-1',
      'org-1',
      token,
      expiresAt,
      '192.0.2.10',
      'unit-test-agent',
    ]);
    expect(query.strings?.join('')).toContain('FROM public.bootstrap_session_create_v1(');
    expect(query.strings?.join('')).not.toContain(token);
  });

  it('rejects malformed creation inputs without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(
      repository.createSession({
        userId: 'bad user',
        organizationId: 'org-1',
        token: 'short',
        expiresAt: new Date('invalid'),
      })
    ).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed when create returns more than one row', async () => {
    const row = {
      session_id: '00000000-0000-4000-8000-000000000001',
      session_created_at: new Date(),
      session_expires_at: expiresAt,
    };
    const { repository } = repositoryWithRows([row, row]);

    await expect(
      repository.createSession({
        userId: 'user-1',
        organizationId: 'org-1',
        token,
        expiresAt,
      })
    ).rejects.toThrow('BOOTSTRAP_SESSION_CREATE_DUPLICATE');
  });

  it('parameterizes activity refresh and maps the stored expiry', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      {
        session_id: 'session-1',
        session_expires_at: '2026-08-13T00:00:00.000Z',
      },
    ]);

    await expect(repository.refreshSession(token)).resolves.toEqual({
      sessionId: 'session-1',
      expiresAt,
    });
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([token]);
    expect(query.strings?.join('')).toContain('FROM public.bootstrap_session_refresh_v1(::text)');
  });

  it('returns neutral results for malformed mutation inputs without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(repository.refreshSession('short')).resolves.toBeNull();
    await expect(repository.invalidateSession('short')).resolves.toBeNull();
    await expect(repository.revokeSelfOtherSessions('short')).resolves.toBeNull();
    await expect(
      repository.revokeAdminUserOrganizationSessions(token, 'bad user')
    ).resolves.toBeNull();
    await expect(
      repository.revokeAdminUserGlobalSingleOrganizationSessions('short', 'user-1')
    ).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('invalidates one token and returns only a session ID', async () => {
    const { repository, queryRaw } = repositoryWithRows([{ session_id: 'session-1' }]);

    await expect(repository.invalidateSession(token)).resolves.toBe('session-1');
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([token]);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_session_invalidate_v1(::text)'
    );
  });

  it('distinguishes an authorized zero-revocation sentinel from authorization failure', async () => {
    const authorized = repositoryWithRows([
      { authorization_proven: true, session_id: null },
    ]).repository;
    const denied = repositoryWithRows([]).repository;

    await expect(authorized.revokeSelfOtherSessions(token)).resolves.toEqual({ sessionIds: [] });
    await expect(denied.revokeSelfOtherSessions(token)).resolves.toBeNull();
  });

  it('parameterizes credential-bound organization revocation and returns session IDs', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      { authorization_proven: true, session_id: 'session-1' },
      { authorization_proven: true, session_id: 'session-2' },
    ]);

    await expect(repository.revokeAdminUserOrganizationSessions(token, 'user-1')).resolves.toEqual({
      sessionIds: ['session-1', 'session-2'],
    });
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([token, 'user-1']);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_session_revoke_admin_user_org_v1('
    );
  });

  it('parameterizes the single-organization global wrapper without caller-selected scope', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      { authorization_proven: true, session_id: 'session-2' },
    ]);

    await expect(
      repository.revokeAdminUserGlobalSingleOrganizationSessions(token, 'user-1')
    ).resolves.toEqual({ sessionIds: ['session-2'] });
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([token, 'user-1']);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_session_revoke_admin_user_global_single_org_v1('
    );
  });

  it('fails closed on invalid envelopes, duplicate IDs, and malformed IDs', async () => {
    const invalidMarker = repositoryWithRows([
      { authorization_proven: false, session_id: null },
    ]).repository;
    await expect(invalidMarker.revokeSelfOtherSessions(token)).rejects.toThrow(
      'BOOTSTRAP_SESSION_REVOCATION_AUTHORIZATION_MARKER_INVALID'
    );

    const mixedSentinel = repositoryWithRows([
      { authorization_proven: true, session_id: null },
      { authorization_proven: true, session_id: 'session-1' },
    ]).repository;
    await expect(mixedSentinel.revokeSelfOtherSessions(token)).rejects.toThrow(
      'BOOTSTRAP_SESSION_REVOCATION_SENTINEL_INVALID'
    );

    const duplicateRepository = repositoryWithRows([
      { authorization_proven: true, session_id: 'session-1' },
      { authorization_proven: true, session_id: 'session-1' },
    ]).repository;
    await expect(
      duplicateRepository.revokeAdminUserOrganizationSessions(token, 'user-1')
    ).rejects.toThrow('BOOTSTRAP_SESSION_MUTATION_DUPLICATE_SESSION_ID');

    const malformedRepository = repositoryWithRows([
      { authorization_proven: true, session_id: 'bad session' },
    ]).repository;
    await expect(malformedRepository.revokeSelfOtherSessions(token)).rejects.toThrow(
      'BOOTSTRAP_SESSION_MUTATION_ROW_INVALID'
    );
  });

  it('grants only create, refresh, and invalidate while keeping bulk revoke owner-only', () => {
    const foundationMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql'
      ),
      'utf8'
    );
    expect(foundationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bootstrap_session_create_v1('
    );
    expect(foundationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bootstrap_session_refresh_v1(text) FROM vaultspace_app;'
    );
    expect(foundationMigration).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_(create|refresh|invalidate|revoke)/i
    );
    expect(foundationMigration).not.toContain('DATABASE_URL_ADMIN');

    const conversionMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260812230000_w1_2_session_mutation_route_conversion/migration.sql'
      ),
      'utf8'
    );
    expect(conversionMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_create_v1\(/i
    );
    expect(conversionMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_refresh_v1\(text\)/i
    );
    expect(conversionMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_invalidate_v1\(text\)/i
    );
    expect(conversionMigration).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_revoke/i
    );

    const boundedMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260813050000_w1_2_bounded_bulk_session_revocation/migration.sql'
      ),
      'utf8'
    );
    expect(boundedMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_revoke_self_others_v1\(text\)/i
    );
    expect(boundedMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_revoke_admin_user_org_v1\(text, text\)/i
    );
    expect(boundedMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_revoke_admin_user_global_single_org_v1\(/i
    );
    expect(boundedMigration).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.bootstrap_session_revoke_user_(org|global)_v1/i
    );

    const creationFiles = [
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/2fa/validate/route.ts',
      'src/app/api/auth/register/route.ts',
      'src/app/api/setup/route.ts',
    ];
    for (const file of creationFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).toContain('createSession(');
      expect(source, file).not.toMatch(/(?:db|bootstrapDb|tx)\.session\.create\(/);
    }

    const sessionSource = readFileSync(resolve(process.cwd(), 'src/lib/auth/session.ts'), 'utf8');
    expect(sessionSource).toContain('sessionMutationRepository.refreshSession(token)');
    expect(sessionSource).toContain('sessionMutationRepository.invalidateSession(token)');
    expect(sessionSource).not.toContain('bootstrapDb');
    expect(sessionSource).not.toMatch(/db\.session\.(create|update)\(/);

    const logoutSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/logout/route.ts'),
      'utf8'
    );
    expect(logoutSource).toContain('bootstrapRepository.resolveSession(sessionToken)');
    expect(logoutSource).not.toContain('bootstrapDb');

    const passwordChangeSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/change-password/route.ts'),
      'utf8'
    );
    expect(passwordChangeSource).toContain('revokeSelfOtherSessionsInTx');
    expect(passwordChangeSource).not.toMatch(/(?:bootstrapDb|tx)\.session\.updateMany/);

    const adminUserSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/users/[userId]/route.ts'),
      'utf8'
    );
    expect(adminUserSource).toContain('revokeAdminUserOrgSessionsInTx');
    expect(adminUserSource).toContain('revokeAdminUserGlobalSingleOrgSessionsInTx');
    expect(adminUserSource).not.toContain('deactivateUserOrgSessionsInTx');

    const resetSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/reset-password/route.ts'),
      'utf8'
    );
    expect(resetSource).toContain('new PasswordResetCapabilityRepository(tx)');
    expect(resetSource).toContain('clearSessionCache(redemption.revokedSessionIds)');
    expect(resetSource).not.toContain('deactivateAllUserSessionsInTx');
    expect(resetSource).not.toContain('bootstrapDb');
  });
});
