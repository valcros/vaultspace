import { describe, expect, it, vi } from 'vitest';

import { BootstrapRepository, type BootstrapQueryClient } from '@/lib/auth/bootstrapRepository';

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    normalized_email: 'user@example.com',
    first_name: 'Test',
    last_name: 'User',
    password_hash: 'stored-password-hash',
    user_is_active: true,
    two_factor_enabled: false,
    organization_id: 'org-1',
    organization_name: 'Test Organization',
    organization_slug: 'test-organization',
    organization_role: 'ADMIN',
    ...overrides,
  };
}

function repositoryWithRows(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const repository = new BootstrapRepository({
    $queryRaw: queryRaw,
  } as unknown as BootstrapQueryClient);
  return { repository, queryRaw };
}

describe('BootstrapRepository login candidate foundation', () => {
  it('uses a parameterized exact function call and maps the minimal projection', async () => {
    const { repository, queryRaw } = repositoryWithRows([candidateRow()]);

    await expect(repository.findLoginCandidate('  USER@EXAMPLE.COM ')).resolves.toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-password-hash',
      userIsActive: true,
      twoFactorEnabled: false,
      organizationId: 'org-1',
      organizationName: 'Test Organization',
      organizationSlug: 'test-organization',
      organizationRole: 'ADMIN',
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(query.values).toEqual(['user@example.com']);
    expect(query.strings?.join('')).toContain('FROM public.bootstrap_login_candidate_v1(::text)');
    expect(query.strings?.join('')).not.toContain('user@example.com');
  });

  it('returns null for no candidate', async () => {
    const { repository } = repositoryWithRows([]);
    await expect(repository.findLoginCandidate('missing@example.com')).resolves.toBeNull();
  });

  it('rejects malformed input without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(repository.findLoginCandidate('  ')).resolves.toBeNull();
    await expect(repository.findLoginCandidate('x'.repeat(256))).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected duplicate projection', async () => {
    const { repository } = repositoryWithRows([candidateRow(), candidateRow()]);
    await expect(repository.findLoginCandidate('user@example.com')).rejects.toThrow(
      'BOOTSTRAP_LOGIN_CANDIDATE_DUPLICATE'
    );
  });

  it('fails closed on an invalid organization role without exposing row values', async () => {
    const { repository } = repositoryWithRows([
      candidateRow({ organization_role: 'UNEXPECTED_ROLE' }),
    ]);

    await expect(repository.findLoginCandidate('user@example.com')).rejects.toThrow(
      'BOOTSTRAP_LOGIN_CANDIDATE_ROLE_INVALID'
    );
  });

  it('fails closed on an incomplete or inactive row', async () => {
    const { repository } = repositoryWithRows([
      candidateRow({ user_is_active: false, password_hash: '' }),
    ]);

    await expect(repository.findLoginCandidate('user@example.com')).rejects.toThrow(
      'BOOTSTRAP_LOGIN_CANDIDATE_ROW_INVALID'
    );
  });
});
