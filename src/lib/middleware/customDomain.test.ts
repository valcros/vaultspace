import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveOrganizationBySlug = vi.fn();
const mockResolveOrganizationByCustomDomain = vi.fn();

vi.mock('@/lib/auth/bootstrapRepository', () => ({
  bootstrapRepository: {
    resolveOrganizationBySlug: (...args: unknown[]) => mockResolveOrganizationBySlug(...args),
    resolveOrganizationByCustomDomain: (...args: unknown[]) =>
      mockResolveOrganizationByCustomDomain(...args),
  },
}));

import { resolveCustomDomain, resolveOrganizationFromHost, resolveSubdomain } from './customDomain';

const organizationProjection = {
  id: 'org-1',
  name: 'CloudVault',
  slug: 'cloudvault',
  customDomain: 'data-room.example.test',
  logoUrl: null,
  primaryColor: '#2563eb',
  faviconUrl: null,
};

describe('runtime-backed organization host resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['MAIN_DOMAINS'] = 'vaultspace.org,vaultspace.local';
  });

  it('resolves an external custom domain through the narrow repository', async () => {
    mockResolveOrganizationByCustomDomain.mockResolvedValue(organizationProjection);

    await expect(resolveCustomDomain('data-room.example.test:443')).resolves.toEqual({
      organizationId: 'org-1',
      organizationSlug: 'cloudvault',
      isCustomDomain: true,
    });

    expect(mockResolveOrganizationByCustomDomain).toHaveBeenCalledWith('data-room.example.test');
  });

  it('resolves a canonical subdomain through the slug lookup', async () => {
    mockResolveOrganizationBySlug.mockResolvedValue(organizationProjection);

    await expect(resolveSubdomain('cloudvault.vaultspace.org')).resolves.toEqual({
      organizationId: 'org-1',
      organizationSlug: 'cloudvault',
      isCustomDomain: false,
    });

    expect(mockResolveOrganizationBySlug).toHaveBeenCalledWith('cloudvault');
  });

  it('tries canonical subdomain resolution after the main-domain custom lookup is skipped', async () => {
    mockResolveOrganizationBySlug.mockResolvedValue(organizationProjection);

    await expect(resolveOrganizationFromHost('cloudvault.vaultspace.org')).resolves.toEqual({
      organizationId: 'org-1',
      organizationSlug: 'cloudvault',
      isCustomDomain: false,
    });

    expect(mockResolveOrganizationByCustomDomain).not.toHaveBeenCalled();
    expect(mockResolveOrganizationBySlug).toHaveBeenCalledWith('cloudvault');
  });

  it('rejects localhost and IP forms before a repository call', async () => {
    await expect(resolveCustomDomain('localhost')).resolves.toBeNull();
    await expect(resolveCustomDomain('127.0.0.1')).resolves.toBeNull();
    await expect(resolveCustomDomain('192.168.1.10')).resolves.toBeNull();
    await expect(resolveCustomDomain('10.0.0.2')).resolves.toBeNull();

    expect(mockResolveOrganizationByCustomDomain).not.toHaveBeenCalled();
  });

  it('logs only categorical data when a custom-domain lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveOrganizationByCustomDomain.mockRejectedValue(
      new Error('postgresql://sensitive-host/private-query')
    );

    await expect(resolveCustomDomain('data-room.example.test')).resolves.toBeNull();

    const log = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
    expect(log).toEqual({
      component: 'organization-resolution',
      event: 'custom_domain_lookup_failed',
      outcome: 'denied',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive-host');
  });
});
