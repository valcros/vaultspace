import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const TARGET_PATTERN = /^vaultspace_password_reset_e2e_[0-9a-f]{32}$/;

// The disposable app process (migrate, generate, setup, build, browser test)
// must never receive the privileged control-database URL or any outbound-email
// credential. Build its environment from an explicit allowlist instead of
// inheriting the operator shell, so a leaked secret cannot reach the
// application under test. Only build/runtime-neutral tooling knobs pass through.
const CHILD_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TERM',
  'USER',
  'LOGNAME',
  'SHELL',
  'TZ',
  'PWD',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'npm_config_cache',
  'npm_config_prefix',
  'npm_config_registry',
  'COREPACK_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'PLAYWRIGHT_BROWSERS_PATH',
];

// Belt-and-suspenders: these must never appear in any child environment, even
// if one is accidentally added to the passthrough list above.
const CHILD_ENV_FORBIDDEN = [
  'PASSWORD_RESET_E2E_CONTROL_DATABASE_URL',
  'ACS_CONNECTION_STRING',
  'SMTP_HOST',
  'SENDGRID_API_KEY',
];

function fail(message) {
  throw new Error(`Password-reset E2E lifecycle: ${message}`);
}

function quoteIdentifier(identifier) {
  if (!TARGET_PATTERN.test(identifier)) fail('generated target name is invalid');
  return `"${identifier}"`;
}

// TARGET_PATTERN admits only a fixed prefix plus lowercase hex, so the name can
// contain no quote, backslash, or semicolon and is safe to embed as a SQL string
// literal. psql does not interpolate :'var' variables in a -c command, so the
// existence check embeds the validated literal directly rather than binding it.
function nameLiteral(identifier) {
  if (!TARGET_PATTERN.test(identifier)) fail('generated target name is invalid');
  return `'${identifier}'`;
}

function controlUrl() {
  const raw = process.env.PASSWORD_RESET_E2E_CONTROL_DATABASE_URL;
  if (!raw) fail('PASSWORD_RESET_E2E_CONTROL_DATABASE_URL is required');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('control URL is not a valid URL');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.pathname !== '/postgres' ||
    url.hash ||
    url.searchParams.has('options') ||
    !url.username ||
    !url.password
  ) {
    fail('control URL must be credentialed local PostgreSQL /postgres without options');
  }
  return url;
}

// psql connects with the control credentials supplied through PG* environment
// variables. Passing the URL as an argv value would expose the password in the
// process table; passing it through a shell would risk interpolation. Neither
// happens here.
function controlPgEnv(control) {
  let user;
  let password;
  try {
    user = decodeURIComponent(control.username);
    password = decodeURIComponent(control.password);
  } catch {
    fail('control URL credentials are not valid percent-encoded values');
  }
  const env = {};
  for (const key of CHILD_ENV_PASSTHROUGH) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  Object.assign(env, {
    PGHOST: control.hostname,
    PGPORT: control.port || '5432',
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: 'postgres',
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '',
  });
  return env;
}

function run(command, args, env, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let stdout = '';
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`child command failed (${command})`))
    );
  });
}

// Query for the disposable database by name using psql variable quoting
// (:'target'), never string interpolation, so the name cannot alter the query.
async function targetExists(pgEnv, name) {
  const output = await run(
    'psql',
    [
      '-v',
      'ON_ERROR_STOP=1',
      '-tAqc',
      `SELECT 1 FROM pg_database WHERE datname = ${nameLiteral(name)}`,
    ],
    pgEnv,
    { capture: true }
  );
  return output.trim() === '1';
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// The Next standalone server serves neither .next/static nor public unless they
// are staged beside server.js. Production does this in the Dockerfile; mirror it
// so the browser test loads real client assets instead of 404s.
async function stageStandaloneAssets() {
  const root = process.cwd();
  const standalone = join(root, '.next', 'standalone');
  if (!(await pathExists(join(standalone, 'server.js')))) {
    fail('standalone build output is missing (.next/standalone/server.js)');
  }
  await cp(join(root, '.next', 'static'), join(standalone, '.next', 'static'), {
    recursive: true,
  });
  if (await pathExists(join(root, 'public'))) {
    await cp(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  }
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  if (!address || typeof address === 'string') fail('could not allocate local test port');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

const control = controlUrl();
const pgEnv = controlPgEnv(control);
const name = `vaultspace_password_reset_e2e_${randomUUID().replaceAll('-', '')}`;
const quotedName = quoteIdentifier(name);

// The application under test only ever speaks postgresql:// to the disposable
// database, matching the guard used by the setup script and Playwright config.
const target = new URL(control.toString());
target.pathname = `/${name}`;
target.protocol = 'postgresql:';
const targetUrl = target.toString();
if (!targetUrl.startsWith('postgresql://') || new URL(targetUrl).pathname !== `/${name}`) {
  fail('could not derive a postgresql:// URL for the disposable database');
}

const port = await unusedLoopbackPort();
const storageDir = await mkdtemp(join(tmpdir(), 'vaultspace-password-reset-e2e-storage-'));

const childEnv = {};
for (const key of CHILD_ENV_PASSTHROUGH) {
  const value = process.env[key];
  if (typeof value === 'string') childEnv[key] = value;
}
Object.assign(childEnv, {
  DATABASE_URL: targetUrl,
  DATABASE_URL_ADMIN: targetUrl,
  MIGRATION_DATABASE_URL: targetUrl,
  DEPLOYMENT_MODE: 'standalone',
  NODE_ENV: 'production',
  STORAGE_PROVIDER: 'local',
  STORAGE_LOCAL_PATH: storageDir,
  NEXT_TELEMETRY_DISABLED: '1',
  PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`,
  PORT: String(port),
  PLAYWRIGHT_PASSWORD_RESET_E2E_ENABLED: 'true',
  PASSWORD_RESET_E2E_MANAGED_LIFECYCLE: 'true',
  PLAYWRIGHT_WEB_SERVER_COMMAND: 'node .next/standalone/server.js',
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  PASSWORD_RESET_TOKEN_WRITE_MODE: 'hmac',
});
for (const key of CHILD_ENV_FORBIDDEN) {
  if (key in childEnv) fail(`forbidden key present in child environment: ${key}`);
}

let created = false;
let cleanupPromise;

// Cleanup is idempotent and runs on both the normal path and on interrupt, so
// an aborted run does not silently orphan the disposable database or its
// temporary storage directory.
function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      let cleanupError;
      if (created) {
        try {
          await run(
            'psql',
            ['-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE)`],
            pgEnv
          );
          if (await targetExists(pgEnv, name)) {
            cleanupError = new Error('disposable database still present after DROP');
          } else {
            created = false;
          }
        } catch (error) {
          cleanupError = error;
        }
      }
      await rm(storageDir, { recursive: true, force: true });
      return cleanupError;
    })();
  }
  return cleanupPromise;
}

async function onSignal(signal) {
  console.error(`Password-reset E2E lifecycle: received ${signal}; cleaning up.`);
  const cleanupError = await cleanup();
  if (cleanupError) {
    console.error(`Cleanup after ${signal} failed: ${cleanupError.message}`);
    console.error('Manually verify and drop the disposable database before retrying.');
  }
  process.exit(1);
}

process.once('SIGINT', () => void onSignal('SIGINT'));
process.once('SIGTERM', () => void onSignal('SIGTERM'));

let primaryError;
try {
  if (await targetExists(pgEnv, name)) {
    fail('generated disposable database already exists; aborting to avoid reuse');
  }
  // Flag creation intent before the statement lands so an interrupt between a
  // committed CREATE and the next line still triggers a DROP IF EXISTS cleanup.
  created = true;
  await run('psql', ['-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${quotedName}`], pgEnv);
  await run('npx', ['prisma', 'generate'], childEnv);
  await run(process.execPath, ['scripts/run-prisma-migrate-deploy.mjs'], childEnv);
  await run('npx', ['tsx', 'scripts/setup-password-reset-e2e-db.ts'], childEnv);
  await run('npm', ['run', 'build'], childEnv);
  await stageStandaloneAssets();
  await run(
    'npx',
    ['playwright', 'test', '--config', 'playwright.password-reset.config.ts'],
    childEnv
  );
} catch (error) {
  primaryError = error;
}

const cleanupError = await cleanup();

if (primaryError && cleanupError) {
  console.error('Password-reset E2E lifecycle failed and cleanup also failed.');
  console.error(`Primary failure: ${primaryError.message}`);
  console.error(`Cleanup failure: ${cleanupError.message}`);
  console.error('Manually verify and drop the disposable database before retrying.');
  process.exitCode = 1;
} else if (primaryError) {
  console.error(`Password-reset E2E lifecycle failed: ${primaryError.message}`);
  process.exitCode = 1;
} else if (cleanupError) {
  console.error(`Password-reset E2E lifecycle cleanup failed: ${cleanupError.message}`);
  console.error('Manually verify and drop the disposable database before retrying.');
  process.exitCode = 1;
}
