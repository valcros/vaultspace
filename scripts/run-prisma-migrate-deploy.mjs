#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createRedactingWriter, resolveMigrationDeploymentUrl } from './migration-startup-gucs.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const prismaCli = join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const sourceUrl = process.env.MIGRATION_DATABASE_URL;

function fail(category) {
  process.stderr.write(`migration_startup_gucs=${category}\n`);
  process.exit(1);
}

if (process.argv.length !== 2) {
  fail('unexpected_arguments');
}

const migrationConfiguration = resolveMigrationDeploymentUrl(sourceUrl);
if ('error' in migrationConfiguration) {
  fail(migrationConfiguration.error);
}
const { derivedUrl, redactions } = migrationConfiguration;
const { MIGRATION_DATABASE_URL: _migrationDatabaseUrl, ...childEnvironment } = process.env;

const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  cwd: process.cwd(),
  env: {
    ...childEnvironment,
    DATABASE_URL: derivedUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  const redactingWriter = createRedactingWriter(redactions, (value) => output.write(value));
  stream.on('data', (chunk) => redactingWriter.write(chunk));
  stream.on('end', () => redactingWriter.end());
}

child.once('error', () => fail('prisma_process_unavailable'));
child.once('close', (code, signal) => {
  if (signal) {
    fail('prisma_process_terminated');
  }
  process.exit(code ?? 1);
});
