const MARKER = 'vaultspace-password-reset-e2e-disposable-v1';
const DATABASE_NAME = /^vaultspace_password_reset_e2e_[a-z0-9_]{2,35}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const PASSWORD_RESET_E2E_MARKER = MARKER;

export function assertPasswordResetE2eEnvironment(environment = process.env): {
  databaseUrl: URL;
  adminDatabaseUrl: URL;
  baseUrl: URL;
} {
  if (environment['PLAYWRIGHT_PASSWORD_RESET_E2E_ENABLED'] !== 'true') {
    throw new Error('Password-reset browser E2E requires explicit opt-in');
  }
  if (environment['PASSWORD_RESET_E2E_MANAGED_LIFECYCLE'] !== 'true') {
    throw new Error('Password-reset browser E2E requires a managed disposable-database lifecycle');
  }
  if (environment['DEPLOYMENT_MODE'] !== 'standalone') {
    throw new Error('Password-reset browser E2E requires standalone mode');
  }
  const databaseUrl = new URL(environment['DATABASE_URL'] ?? '');
  const adminDatabaseUrl = new URL(environment['DATABASE_URL_ADMIN'] ?? '');
  const baseUrl = new URL(environment['PLAYWRIGHT_BASE_URL'] ?? '');
  if (
    !LOCAL_HOSTS.has(databaseUrl.hostname) ||
    !LOCAL_HOSTS.has(adminDatabaseUrl.hostname) ||
    !LOCAL_HOSTS.has(baseUrl.hostname) ||
    databaseUrl.protocol !== 'postgresql:' ||
    adminDatabaseUrl.protocol !== 'postgresql:' ||
    databaseUrl.hostname !== adminDatabaseUrl.hostname ||
    databaseUrl.port !== adminDatabaseUrl.port ||
    databaseUrl.pathname !== adminDatabaseUrl.pathname ||
    !DATABASE_NAME.test(databaseUrl.pathname.slice(1))
  ) {
    throw new Error('Password-reset browser E2E requires its reviewed disposable local database');
  }
  if (
    environment['ACS_CONNECTION_STRING'] ||
    environment['SMTP_HOST'] ||
    environment['SENDGRID_API_KEY']
  ) {
    throw new Error('Password-reset browser E2E forbids outbound email configuration');
  }
  return { databaseUrl, adminDatabaseUrl, baseUrl };
}
