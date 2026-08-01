const STARTUP_OPTIONS = '-c statement_timeout=120s -c lock_timeout=10s';

function decodeComponent(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    return undefined;
  }
}

export function resolveMigrationDeploymentUrl(sourceUrl) {
  if (!sourceUrl) {
    return { error: 'missing_migration_database_url' };
  }

  let migrationUrl;
  try {
    migrationUrl = new URL(sourceUrl);
  } catch {
    return { error: 'invalid_migration_database_url' };
  }

  const database = decodeComponent(migrationUrl.pathname.slice(1));
  const username = decodeComponent(migrationUrl.username);
  const password = decodeComponent(migrationUrl.password);
  if (
    (migrationUrl.protocol !== 'postgresql:' && migrationUrl.protocol !== 'postgres:') ||
    !migrationUrl.hostname ||
    !database ||
    !username ||
    !password ||
    migrationUrl.hash ||
    migrationUrl.searchParams.has('options')
  ) {
    return { error: 'unsupported_migration_database_url' };
  }

  migrationUrl.searchParams.set('options', STARTUP_OPTIONS);
  const derivedUrl = migrationUrl.toString();
  return {
    derivedUrl,
    redactions: [
      sourceUrl,
      derivedUrl,
      migrationUrl.hostname,
      migrationUrl.pathname.slice(1),
      database,
      migrationUrl.username,
      username,
      migrationUrl.password,
      password,
    ].filter(Boolean),
  };
}

export function createRedactingWriter(redactions, write) {
  const tokens = [...new Set(redactions)].sort((left, right) => right.length - left.length);
  let pending = '';

  const redact = (value) =>
    tokens.reduce((redacted, token) => redacted.replaceAll(token, '<redacted>'), value);

  const retainedSuffixLength = () => {
    let retained = 0;
    for (const token of tokens) {
      const maximum = Math.min(token.length - 1, pending.length);
      for (let length = maximum; length > retained; length -= 1) {
        if (token.startsWith(pending.slice(-length))) {
          retained = length;
          break;
        }
      }
    }
    return retained;
  };

  return {
    write(chunk) {
      pending += chunk.toString('utf8');
      const retained = retainedSuffixLength();
      const safePrefix = pending.slice(0, pending.length - retained);
      pending = pending.slice(pending.length - retained);
      if (safePrefix) {
        write(redact(safePrefix));
      }
    },
    end() {
      if (pending) {
        write(redact(pending));
        pending = '';
      }
    },
  };
}
