import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  PasswordResetIssuanceCapabilityRepository,
  type PasswordResetIssuanceCapabilityQueryClient,
} from './passwordResetIssuanceCapabilityRepository';

const actorToken = 'a'.repeat(43);
const storedToken = `prh1:${'b'.repeat(64)}`;
const envelope = {
  cipherVersion: 2 as const,
  keyId: 'key-2026-08',
  nonce: Buffer.alloc(12, 1),
  ciphertext: Buffer.alloc(48, 2),
  authTag: Buffer.alloc(16, 3),
  recipientFingerprint: 'c'.repeat(64),
};

function repositoryWithRows(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const repository = new PasswordResetIssuanceCapabilityRepository({
    $queryRaw: queryRaw,
  } as unknown as PasswordResetIssuanceCapabilityQueryClient);
  return { repository, queryRaw };
}

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    authorization_proven: true,
    flow_id: 'flow-1',
    audit_organization_ids: ['org-1', 'org-2'],
    superseded_flow_ids: ['flow-2', 'flow-3'],
    superseded_request_ids: ['request-2', null],
    ...overrides,
  };
}

function anonymousInput() {
  return {
    normalizedEmail: 'user@example.test',
    requestedSenderOrgSlug: 'cloud-vault',
    flowId: 'flow-1',
    storedToken,
    requestId: 'request-1',
    envelope,
  };
}

function queryParts(queryRaw: ReturnType<typeof vi.fn>) {
  return queryRaw.mock.calls[0]?.[0] as { strings?: string[]; values?: unknown[] };
}

describe('PasswordResetIssuanceCapabilityRepository', () => {
  it('parameterizes anonymous issuance and maps only the minimal result envelope', async () => {
    const { repository, queryRaw } = repositoryWithRows([issueRow()]);

    await expect(repository.issueAnonymous(anonymousInput())).resolves.toEqual({
      flowId: 'flow-1',
      auditOrganizationIds: ['org-1', 'org-2'],
      supersededFlows: [
        { flowId: 'flow-2', requestId: 'request-2' },
        { flowId: 'flow-3', requestId: null },
      ],
    });
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([
      'user@example.test',
      'cloud-vault',
      'flow-1',
      storedToken,
      'request-1',
      2,
      envelope.keyId,
      envelope.nonce,
      envelope.ciphertext,
      envelope.authTag,
      envelope.recipientFingerprint,
    ]);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_password_reset_issue_anonymous_v1('
    );
    expect(query.strings?.join('')).not.toContain(storedToken);
  });

  it('returns a neutral no-row result and rejects malformed anonymous inputs before SQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);
    await expect(repository.issueAnonymous(anonymousInput())).resolves.toBeNull();
    await expect(
      repository.issueAnonymous({ ...anonymousInput(), normalizedEmail: 'User@example.test' })
    ).resolves.toBeNull();
    await expect(
      repository.issueAnonymous({ ...anonymousInput(), storedToken: 'legacy-token' })
    ).resolves.toBeNull();
    await expect(
      repository.issueAnonymous({
        ...anonymousInput(),
        envelope: { ...envelope, nonce: Buffer.alloc(11) },
      })
    ).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails closed if anonymous issuance returns identity data or malformed arrays', async () => {
    const invalidRows = [
      issueRow({ subject_user_id: 'user-1' }),
      issueRow({ audit_organization_ids: [] }),
      issueRow({ audit_organization_ids: ['org-2', 'org-1'] }),
      issueRow({ superseded_flow_ids: ['flow-2'], superseded_request_ids: [] }),
      issueRow({ superseded_flow_ids: ['flow-1'], superseded_request_ids: [null] }),
    ];
    for (const row of invalidRows) {
      await expect(
        repositoryWithRows([row]).repository.issueAnonymous(anonymousInput())
      ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_ISSUANCE_ENVELOPE_INVALID');
    }
  });

  it('prepares only the authoritative recipient email for a bounded administrator', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      { authorization_proven: true, recipient_email: 'target@example.test' },
    ]);
    await expect(repository.prepareAdminRecipient(actorToken, 'target-1')).resolves.toEqual({
      recipientEmail: 'target@example.test',
    });
    const query = queryParts(queryRaw);
    expect(query.values).toEqual([actorToken, 'target-1']);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_password_reset_admin_recipient_v1('
    );
  });

  it('fails closed on recipient identity expansion, noncanonical email, and duplicate rows', async () => {
    await expect(
      repositoryWithRows([
        {
          authorization_proven: true,
          recipient_email: 'target@example.test',
          target_user_id: 'target-1',
        },
      ]).repository.prepareAdminRecipient(actorToken, 'target-1')
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_ENVELOPE_INVALID');
    await expect(
      repositoryWithRows([
        { authorization_proven: true, recipient_email: 'Target@example.test' },
      ]).repository.prepareAdminRecipient(actorToken, 'target-1')
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_ENVELOPE_INVALID');
    await expect(
      repositoryWithRows([
        { authorization_proven: true, recipient_email: 'target@example.test' },
        { authorization_proven: true, recipient_email: 'target@example.test' },
      ]).repository.prepareAdminRecipient(actorToken, 'target-1')
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_DUPLICATE');
  });

  it('requires one canonical audit organization for administrator issuance', async () => {
    const { repository, queryRaw } = repositoryWithRows([
      issueRow({ audit_organization_ids: ['org-1'] }),
    ]);
    const input = {
      actorToken,
      targetUserId: 'target-1',
      expectedNormalizedEmail: 'target@example.test',
      flowId: 'flow-1',
      storedToken,
      requestId: 'request-1',
      envelope,
    };
    await expect(repository.issueAdminSingleOrg(input)).resolves.toMatchObject({
      flowId: 'flow-1',
      auditOrganizationIds: ['org-1'],
    });
    expect(queryParts(queryRaw).strings?.join('')).toContain(
      'FROM public.bootstrap_password_reset_issue_admin_single_org_v1('
    );
    await expect(
      repositoryWithRows([issueRow()]).repository.issueAdminSingleOrg(input)
    ).rejects.toThrow('BOOTSTRAP_PASSWORD_RESET_ISSUANCE_ENVELOPE_INVALID');
  });

  it('keeps the new repository unrouted and free of elevated database clients', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const repository = readFileSync(
      resolve(sourceRoot, 'lib/auth/passwordResetIssuanceCapabilityRepository.ts'),
      'utf8'
    );
    expect(repository).not.toContain('bootstrapDb');
    expect(repository).not.toContain('DATABASE_URL_ADMIN');
    expect(repository).not.toMatch(/\.(?:find|create|update|delete)(?:Many)?\(/);

    const productionSources = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.(?:ts|tsx)$/.test(entry.name) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx') &&
          entry.name !== 'passwordResetIssuanceCapabilityRepository.ts'
      )
      .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), 'utf8'));
    for (const source of productionSources) {
      expect(source).not.toContain('passwordResetIssuanceCapabilityRepository');
    }
  });

  it('keeps the Unit 12 migration inert, owner-only, and checksum-bound', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260814010000_w1_2_password_reset_issuance_foundation/migration.sql'
      ),
      'utf8'
    );
    expect(migration).toContain('vaultspace-contract:w1-2-password-reset-issue-anonymous-v1');
    expect(migration).toContain('vaultspace-contract:w1-2-password-reset-admin-recipient-v1');
    expect(migration).toContain(
      'vaultspace-contract:w1-2-password-reset-issue-admin-single-org-v1'
    );
    expect(migration).toContain('5f6f28595a24f218dfe2afda96a67eef');
    expect(migration).toContain('66d39e5da1e0d1ec3d5183a3abdce0fe');
    expect(migration).toContain('bbfbfca5c550275c6636c7c65cb1e589');
    expect(migration).toContain('BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID');
    expect(migration).toContain('BOOTSTRAP_RUNTIME_RESET_PRIVILEGES_CHANGED');
    expect(migration).toContain('ORDER BY acl_key COLLATE pg_catalog."C"');
    expect(migration).toContain('FROM vaultspace_app;');
    expect(migration).toContain('FROM PUBLIC;');
    expect(migration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/i);
    expect(migration).not.toContain('DATABASE_URL_ADMIN');
  });
});
