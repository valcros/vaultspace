import { afterEach, describe, expect, it } from 'vitest';

import {
  getProtectedOrganizationSlugs,
  ProtectedOrganizationConfigurationError,
} from './protectedOrgs';

describe('getProtectedOrganizationSlugs', () => {
  afterEach(() => {
    delete process.env['PLATFORM_PROTECTED_ORG_SLUGS'];
  });

  it('accepts a non-empty JSON array of normalized synthetic slugs', () => {
    expect(getProtectedOrganizationSlugs('["protected-tenant-a", "protected-tenant-b"]')).toEqual([
      'protected-tenant-a',
      'protected-tenant-b',
    ]);
  });

  it.each([undefined, '', '[]', '["mixed Case"]', '["duplicate", "duplicate"]', '{"slug":"x"}'])(
    'rejects missing, malformed, invalid, or duplicate configuration: %j',
    (value) => {
      expect(() => getProtectedOrganizationSlugs(value)).toThrow(
        ProtectedOrganizationConfigurationError
      );
    }
  );
});
