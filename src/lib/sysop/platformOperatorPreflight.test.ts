import { describe, expect, it } from 'vitest';

import {
  assertActivePlatformOperatorCount,
  assertLastActivePlatformOperatorIsRetained,
  assertSysopRolloutReadiness,
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

  it('blocks rollout flags until MFA and named access have a viable operator', () => {
    const none = { activeMfaOperators: 0, consoleReadyOperators: 0, capabilityManagers: 0 };
    expect(() => assertSysopRolloutReadiness(none, {})).not.toThrow();
    expect(() =>
      assertSysopRolloutReadiness(none, { SYSOP_MODE_ENFORCEMENT_ENABLED: 'true' })
    ).toThrow('MFA-enrolled operator');
    expect(() =>
      assertSysopRolloutReadiness(
        { ...none, activeMfaOperators: 1 },
        {
          SYSOP_MODE_ENFORCEMENT_ENABLED: 'true',
          SYSOP_CAPABILITY_ENFORCEMENT_ENABLED: 'true',
        }
      )
    ).toThrow('console operator and capability manager');
    expect(() =>
      assertSysopRolloutReadiness(
        { activeMfaOperators: 1, consoleReadyOperators: 1, capabilityManagers: 1 },
        { SYSOP_CAPABILITY_ENFORCEMENT_ENABLED: 'true' }
      )
    ).toThrow('mode enforcement before capability enforcement');
    expect(() =>
      assertSysopRolloutReadiness(
        { activeMfaOperators: 1, consoleReadyOperators: 1, capabilityManagers: 1 },
        {
          SYSOP_MODE_ENFORCEMENT_ENABLED: 'true',
          SYSOP_CAPABILITY_ENFORCEMENT_ENABLED: 'true',
        }
      )
    ).not.toThrow();
  });
});
