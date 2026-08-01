import { spawnSync } from 'child_process';
import { resolve } from 'path';

import { describe, expect, it } from 'vitest';

import { createRedactingWriter, resolveMigrationDeploymentUrl } from './migration-startup-gucs.mjs';

const wrapper = resolve(process.cwd(), 'scripts', 'run-prisma-migrate-deploy.mjs');

function runWrapper(migrationUrl?: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [wrapper], {
    env: {
      PATH: process.env['PATH'] ?? '',
      NODE_ENV: 'test',
      ...(migrationUrl ? { MIGRATION_DATABASE_URL: migrationUrl } : {}),
    },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('migration startup GUC wrapper', () => {
  it('fails closed with categorical output before starting Prisma', () => {
    const missing = runWrapper();
    expect(missing).toEqual({
      status: 1,
      output: 'migration_startup_gucs=missing_migration_database_url\n',
    });

    const invalidUrl = 'https://user:secret@example.test/vaultspace';
    const invalid = runWrapper(invalidUrl);
    expect(invalid).toEqual({
      status: 1,
      output: 'migration_startup_gucs=unsupported_migration_database_url\n',
    });
    expect(invalid.output).not.toContain(invalidUrl);
    expect(invalid.output).not.toContain('secret');

    const existingOptions =
      'postgresql://migration_user:secret@localhost/vaultspace?options=-c%20statement_timeout%3D1s';
    const conflicting = runWrapper(existingOptions);
    expect(conflicting).toEqual({
      status: 1,
      output: 'migration_startup_gucs=unsupported_migration_database_url\n',
    });
    expect(conflicting.output).not.toContain(existingOptions);

    const malformedPercent = 'postgresql://migration_user:secret%@localhost/vaultspace';
    const malformed = runWrapper(malformedPercent);
    expect(malformed).toEqual({
      status: 1,
      output: 'migration_startup_gucs=unsupported_migration_database_url\n',
    });
    expect(malformed.output).not.toContain('secret%');
  });

  it('preserves reviewed URL parameters and adds exactly the fixed startup options', () => {
    const source =
      'postgresql://migration_user:secret@db.example.test/vaultspace?schema=public&sslmode=require';
    const configuration = resolveMigrationDeploymentUrl(source);

    expect('error' in configuration).toBe(false);
    if ('error' in configuration) {
      throw new Error(configuration.error);
    }
    const derived = new URL(configuration.derivedUrl);
    expect(derived.searchParams.get('schema')).toBe('public');
    expect(derived.searchParams.get('sslmode')).toBe('require');
    expect(derived.searchParams.getAll('options')).toEqual([
      '-c statement_timeout=120s -c lock_timeout=10s',
    ]);
  });

  it('redacts every protected URL component across arbitrary output chunks', () => {
    const source =
      'postgresql://migration%20user:secret%25value@db.example.test/vaultspace%20prod?schema=public';
    const configuration = resolveMigrationDeploymentUrl(source);
    expect('error' in configuration).toBe(false);
    if ('error' in configuration) {
      throw new Error(configuration.error);
    }
    const protectedValues = [
      source,
      configuration.derivedUrl,
      'migration user',
      'secret%value',
      'db.example.test',
      'vaultspace prod',
    ];
    const emitted: string[] = [];
    const writer = createRedactingWriter(configuration.redactions, (value: string) => {
      emitted.push(value);
    });
    const childOutput = `before ${source} ${configuration.derivedUrl} migration user secret%value db.example.test vaultspace prod after`;
    for (let index = 0; index < childOutput.length; index += 3) {
      writer.write(Buffer.from(childOutput.slice(index, index + 3)));
    }
    writer.end();
    const redacted = emitted.join('');

    for (const value of protectedValues) {
      expect(redacted).not.toContain(value);
    }
    expect(redacted).toContain('<redacted>');
  });
});
