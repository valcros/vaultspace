import { describe, expect, it, vi } from 'vitest';

import { BootstrapRepository, type BootstrapQueryClient } from '@/lib/auth/bootstrapRepository';
import { SESSION_CONFIG } from '@/lib/constants';

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

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    session_created_at: new Date('2026-08-12T00:00:00.000Z'),
    session_expires_at: new Date('2026-08-13T00:00:00.000Z'),
    session_last_active_at: new Date('2026-08-12T01:00:00.000Z'),
    user_email: 'user@example.com',
    user_first_name: 'Test',
    user_last_name: 'User',
    user_is_active: true,
    organization_name: 'Test Organization',
    organization_slug: 'test-organization',
    organization_role: 'VIEWER',
    can_manage_users: false,
    can_manage_rooms: true,
    ...overrides,
  };
}

function organizationRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: 'org-1',
    organization_name: 'Test Organization',
    organization_slug: 'test-organization',
    organization_custom_domain: 'data-room.example.test',
    organization_logo_url: 'https://assets.example.test/logo.png',
    organization_primary_color: '#2563eb',
    organization_favicon_url: null,
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

describe('BootstrapRepository session resolve foundation', () => {
  const token = 's'.repeat(43);

  it('stays aligned with the reviewed token and absolute-expiry database contract', () => {
    expect(SESSION_CONFIG.TOKEN_LENGTH).toBe(32);
    expect(SESSION_CONFIG.ABSOLUTE_MAX_DAYS).toBe(7);
    expect(Buffer.from('x'.repeat(SESSION_CONFIG.TOKEN_LENGTH)).toString('base64url')).toHaveLength(
      43
    );
  });

  it('uses a parameterized exact function call and maps the minimal projection', async () => {
    const { repository, queryRaw } = repositoryWithRows([sessionRow()]);

    await expect(repository.resolveSession(token)).resolves.toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      expiresAt: new Date('2026-08-13T00:00:00.000Z'),
      lastActiveAt: new Date('2026-08-12T01:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
      },
      organization: {
        id: 'org-1',
        name: 'Test Organization',
        slug: 'test-organization',
        role: 'VIEWER',
        canManageUsers: false,
        canManageRooms: true,
      },
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(query.values).toEqual([token]);
    expect(query.strings?.join('')).toContain('FROM public.bootstrap_session_resolve_v1(::text)');
    expect(query.strings?.join('')).not.toContain(token);
  });

  it('returns null for no matching active session', async () => {
    const { repository } = repositoryWithRows([]);
    await expect(repository.resolveSession(token)).resolves.toBeNull();
  });

  it('rejects malformed opaque tokens without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(repository.resolveSession('')).resolves.toBeNull();
    await expect(repository.resolveSession('short')).resolves.toBeNull();
    await expect(repository.resolveSession('x'.repeat(42) + '!')).resolves.toBeNull();
    await expect(repository.resolveSession('x'.repeat(44))).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected duplicate projection', async () => {
    const { repository } = repositoryWithRows([sessionRow(), sessionRow()]);
    await expect(repository.resolveSession(token)).rejects.toThrow('BOOTSTRAP_SESSION_DUPLICATE');
  });

  it('fails closed on an invalid organization role', async () => {
    const { repository } = repositoryWithRows([
      sessionRow({ organization_role: 'UNEXPECTED_ROLE' }),
    ]);

    await expect(repository.resolveSession(token)).rejects.toThrow(
      'BOOTSTRAP_SESSION_ROLE_INVALID'
    );
  });

  it('fails closed on invalid timestamps without exposing row values', async () => {
    const { repository } = repositoryWithRows([
      sessionRow({ session_expires_at: 'not-a-timestamp' }),
    ]);

    await expect(repository.resolveSession(token)).rejects.toThrow(
      'BOOTSTRAP_SESSION_EXPIRES_AT_INVALID'
    );
  });

  it('fails closed on an incomplete or inactive projection', async () => {
    const { repository } = repositoryWithRows([
      sessionRow({ user_is_active: false, organization_slug: '' }),
    ]);

    await expect(repository.resolveSession(token)).rejects.toThrow('BOOTSTRAP_SESSION_ROW_INVALID');
  });
});

describe('BootstrapRepository organization resolve foundation', () => {
  const expectedProjection = {
    id: 'org-1',
    name: 'Test Organization',
    slug: 'test-organization',
    customDomain: 'data-room.example.test',
    logoUrl: 'https://assets.example.test/logo.png',
    primaryColor: '#2563eb',
    faviconUrl: null,
  };

  it('uses a parameterized exact slug lookup and maps only public organization fields', async () => {
    const { repository, queryRaw } = repositoryWithRows([organizationRow()]);

    await expect(repository.resolveOrganizationBySlug('  TEST-ORGANIZATION ')).resolves.toEqual(
      expectedProjection
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(query.values).toEqual(['SLUG', 'test-organization']);
    expect(query.strings?.join('')).toContain(
      'FROM public.bootstrap_organization_resolve_v1(\n          ::text,\n          ::text\n        )'
    );
    expect(query.strings?.join('')).not.toContain('test-organization');
  });

  it('uses a parameterized exact custom-domain lookup', async () => {
    const { repository, queryRaw } = repositoryWithRows([organizationRow()]);

    await expect(
      repository.resolveOrganizationByCustomDomain('  DATA-ROOM.EXAMPLE.TEST ')
    ).resolves.toEqual(expectedProjection);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as { values?: unknown[] };
    expect(query.values).toEqual(['CUSTOM_DOMAIN', 'data-room.example.test']);
  });

  it('returns null when no active organization matches', async () => {
    const { repository } = repositoryWithRows([]);
    await expect(repository.resolveOrganizationBySlug('missing-org')).resolves.toBeNull();
    await expect(
      repository.resolveOrganizationByCustomDomain('missing.example.test')
    ).resolves.toBeNull();
  });

  it('rejects malformed slugs without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(repository.resolveOrganizationBySlug('')).resolves.toBeNull();
    await expect(repository.resolveOrganizationBySlug('bad.slug')).resolves.toBeNull();
    await expect(repository.resolveOrganizationBySlug('bad slug')).resolves.toBeNull();
    await expect(repository.resolveOrganizationBySlug('x'.repeat(101))).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects malformed custom domains without querying PostgreSQL', async () => {
    const { repository, queryRaw } = repositoryWithRows([]);

    await expect(repository.resolveOrganizationByCustomDomain('')).resolves.toBeNull();
    await expect(repository.resolveOrganizationByCustomDomain('localhost')).resolves.toBeNull();
    await expect(
      repository.resolveOrganizationByCustomDomain('https://data-room.example.test')
    ).resolves.toBeNull();
    await expect(
      repository.resolveOrganizationByCustomDomain('data-room.example.test:443')
    ).resolves.toBeNull();
    await expect(
      repository.resolveOrganizationByCustomDomain('data-room..example.test')
    ).resolves.toBeNull();
    await expect(
      repository.resolveOrganizationByCustomDomain('x'.repeat(64) + '.example.test')
    ).resolves.toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected duplicate projection', async () => {
    const { repository } = repositoryWithRows([organizationRow(), organizationRow()]);
    await expect(repository.resolveOrganizationBySlug('test-organization')).rejects.toThrow(
      'BOOTSTRAP_ORGANIZATION_DUPLICATE'
    );
  });

  it('fails closed on an incomplete or malformed projection', async () => {
    const { repository } = repositoryWithRows([
      organizationRow({
        organization_slug: 'INVALID.SLUG',
        organization_primary_color: 'blue',
      }),
    ]);

    await expect(repository.resolveOrganizationBySlug('test-organization')).rejects.toThrow(
      'BOOTSTRAP_ORGANIZATION_ROW_INVALID'
    );
  });
});
