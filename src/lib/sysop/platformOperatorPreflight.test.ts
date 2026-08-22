import { describe, expect, it } from 'vitest';

import {
  assertActivePlatformOperatorCount,
  assertLastActivePlatformOperatorIsRetained,
  LAST_ACTIVE_PLATFORM_OPERATOR_ERROR,
  NO_ACTIVE_PLATFORM_OPERATOR_ERROR,
  resolvePlatformOperatorDatabaseUrl,
} from './platformOperatorPreflight';

describe('platform operator continuity guards', () => {
  it('uses the available operator-capable connection in a predictable order', () => {
    expect(
      resolvePlatformOperatorDatabaseUrl({
        DATABASE_URL: 'runtime-url',
        MIGRATION_DATABASE_URL: 'migration-url',
        DATABASE_URL_ADMIN: 'admin-url',
      })
    ).toBe('admin-url');
    expect(
      resolvePlatformOperatorDatabaseUrl({
        DATABASE_URL: 'runtime-url',
        MIGRATION_DATABASE_URL: 'migration-url',
      })
    ).toBe('migration-url');
    expect(resolvePlatformOperatorDatabaseUrl({ DATABASE_URL: 'runtime-url' })).toBe('runtime-url');
    expect(resolvePlatformOperatorDatabaseUrl({})).toBeNull();
  });

  it('rejects a release when no active platform operator exists', () => {
    expect(() => assertActivePlatformOperatorCount(0)).toThrow(NO_ACTIVE_PLATFORM_OPERATOR_ERROR);
    expect(() => assertActivePlatformOperatorCount(-1)).toThrow(NO_ACTIVE_PLATFORM_OPERATOR_ERROR);
    expect(() => assertActivePlatformOperatorCount(1.5)).toThrow(NO_ACTIVE_PLATFORM_OPERATOR_ERROR);
    expect(() => assertActivePlatformOperatorCount(1)).not.toThrow();
  });

  it('refuses ordinary revocation of the last active platform operator', () => {
    expect(() => assertLastActivePlatformOperatorIsRetained(0)).toThrow(
      LAST_ACTIVE_PLATFORM_OPERATOR_ERROR
    );
    expect(() => assertLastActivePlatformOperatorIsRetained(1)).toThrow(
      LAST_ACTIVE_PLATFORM_OPERATOR_ERROR
    );
    expect(() => assertLastActivePlatformOperatorIsRetained(2)).not.toThrow();
  });
});
