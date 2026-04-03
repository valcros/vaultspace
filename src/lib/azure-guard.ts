/**
 * Azure Runtime Guard
 *
 * VaultSpace supports two deployment modes:
 * - azure (default): Enforces Azure services. Blocks startup if misconfigured.
 * - standalone: Allows non-Azure services for self-hosted deployments.
 *
 * Set DEPLOYMENT_MODE=standalone to enable self-hosted operation.
 */

import { getDeploymentMode, isStandaloneMode } from './deployment-mode';

const AZURE_ONLY_ERROR = `
+------------------------------------------------------------------------------+
|                                                                              |
|   LOCAL EXECUTION BLOCKED                                                    |
|                                                                              |
|   VaultSpace is configured for Azure-only operation (default).               |
|   Local execution is not permitted in Azure mode.                            |
|                                                                              |
|   Options:                                                                   |
|   1. Deploy to Azure Container Apps with Azure services                      |
|   2. Set DEPLOYMENT_MODE=standalone for self-hosted operation                |
|                                                                              |
|   For Azure mode, configure:                                                 |
|   - Azure PostgreSQL for database                                            |
|   - Azure Blob Storage for files                                             |
|   - Azure Cache for Redis (recommended)                                      |
|                                                                              |
|   For Standalone mode, configure:                                            |
|   - Any PostgreSQL 15+ server                                                |
|   - S3-compatible storage or local filesystem                                |
|   - Redis (optional, enables async features)                                 |
|                                                                              |
+------------------------------------------------------------------------------+
`;

/**
 * Check if a URL points to localhost
 */
export function isLocalhost(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes('host.docker.internal') ||
    (lower.match(/postgres:\/\/[^@]*@[^:]*:5432/) !== null &&
      !lower.includes('.database.azure.com'))
  );
}

/**
 * Check if running in a local development context.
 * Only relevant in Azure mode - standalone mode allows local services.
 */
function isLocalEnvironment(): boolean {
  // Standalone mode explicitly allows local services
  if (isStandaloneMode()) {
    return false;
  }

  // Check for explicit Azure deployment indicators
  const hasAzureIndicators =
    process.env['WEBSITE_SITE_NAME'] || // Azure App Service / Container Apps
    process.env['CONTAINER_APP_NAME'] || // Azure Container Apps
    process.env['AZURE_FUNCTIONS_ENVIRONMENT']; // Azure Functions

  if (hasAzureIndicators) {
    return false; // Running in Azure
  }

  // In Azure mode without Azure indicators, check for localhost
  // Check DATABASE_URL for localhost
  if (isLocalhost(process.env['DATABASE_URL'])) {
    return true;
  }

  // Check REDIS_URL for localhost (only if set - Redis is optional in standalone)
  if (process.env['REDIS_URL'] && isLocalhost(process.env['REDIS_URL'])) {
    return true;
  }

  // Check for typical local development indicators
  if (process.env['NODE_ENV'] === 'development' && !process.env['AZURE_DEPLOYMENT']) {
    return true;
  }

  return false;
}

/**
 * Enforce deployment mode restrictions.
 * In Azure mode: blocks local execution.
 * In Standalone mode: allows any configuration.
 *
 * Call this at application startup.
 */
export function enforceDeploymentMode(): void {
  const mode = getDeploymentMode();

  if (mode === 'standalone') {
    // Standalone mode allows any configuration
    console.log('[DeploymentGuard] Running in standalone mode');
    return;
  }

  // Azure mode - enforce Azure-only execution
  if (isLocalEnvironment()) {
    console.error(AZURE_ONLY_ERROR);
    process.exit(1);
  }

  console.log('[DeploymentGuard] Running in Azure mode');
}

/**
 * @deprecated Use enforceDeploymentMode() instead
 */
export function enforceAzureOnly(): void {
  enforceDeploymentMode();
}

/**
 * Validate configuration based on deployment mode.
 * Azure mode: requires Azure services.
 * Standalone mode: requires PostgreSQL and storage (any provider).
 */
export function validateConfig(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mode = getDeploymentMode();

  // DATABASE_URL is always required
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    errors.push('DATABASE_URL is not set');
  }

  if (mode === 'azure') {
    // Azure mode: enforce Azure services
    if (
      dbUrl &&
      !dbUrl.includes('.database.azure.com') &&
      !dbUrl.includes('.postgres.database.azure.com')
    ) {
      errors.push('DATABASE_URL must point to Azure PostgreSQL (.database.azure.com)');
    }

    // Check REDIS_URL points to Azure Cache for Redis
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl && !redisUrl.includes('.redis.cache.windows.net')) {
      errors.push('REDIS_URL must point to Azure Cache for Redis (.redis.cache.windows.net)');
    }

    // Check Azure Storage is configured
    // Accept: connection string OR (account name + key)
    const hasConnectionString = !!process.env['AZURE_STORAGE_CONNECTION_STRING'];
    const hasAccountName =
      !!process.env['AZURE_STORAGE_ACCOUNT'] || !!process.env['AZURE_STORAGE_ACCOUNT_NAME'];
    const hasAccountKey = !!process.env['AZURE_STORAGE_ACCOUNT_KEY'];

    if (!hasConnectionString && !(hasAccountName && hasAccountKey)) {
      errors.push(
        'Azure Storage configuration is required: either AZURE_STORAGE_CONNECTION_STRING, or both AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCOUNT_KEY'
      );
    }
  } else {
    // Standalone mode: check for required services
    // Storage must be configured (S3-compatible or local)
    const hasS3 = !!process.env['S3_ENDPOINT'] || !!process.env['AWS_S3_BUCKET'];
    const hasLocalStorage =
      process.env['STORAGE_PROVIDER'] === 'local' && !!process.env['STORAGE_LOCAL_PATH'];

    if (!hasS3 && !hasLocalStorage) {
      errors.push(
        'Storage configuration required: S3-compatible (S3_ENDPOINT or AWS_S3_BUCKET) or local (STORAGE_PROVIDER=local + STORAGE_LOCAL_PATH)'
      );
    }

    // Warn about optional services
    if (!process.env['REDIS_URL']) {
      warnings.push(
        'Redis not configured - async features will be unavailable (previews, scheduled jobs, bulk operations)'
      );
    }

    if (!process.env['CLAMAV_HOST']) {
      warnings.push(
        'ClamAV not configured - virus scanning disabled. Uploads will proceed without scanning.'
      );
    }

    if (!process.env['GOTENBERG_URL']) {
      warnings.push(
        'Gotenberg not configured - Office document previews will be unavailable. Image and PDF previews still work.'
      );
    }

    if (hasLocalStorage) {
      warnings.push(
        'Local filesystem storage configured - single-node only, manual backup required, not suitable for HA deployments.'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * @deprecated Use validateConfig() instead
 */
export function validateAzureConfig(): { valid: boolean; errors: string[] } {
  const result = validateConfig();
  return { valid: result.valid, errors: result.errors };
}

/**
 * Guard for integration tests.
 * Azure mode: blocks tests that target localhost.
 * Standalone mode: allows localhost for local testing.
 */
export function guardIntegrationTests(): void {
  // Standalone mode allows localhost
  if (isStandaloneMode()) {
    return;
  }

  const dbUrl = process.env['DATABASE_URL'] || '';

  if (isLocalhost(dbUrl)) {
    throw new Error(
      `\n\n` +
        `INTEGRATION TEST BLOCKED\n\n` +
        `In Azure mode, tests cannot run against localhost.\n` +
        `DATABASE_URL must point to Azure PostgreSQL.\n\n` +
        `Current DATABASE_URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}\n\n` +
        `Options:\n` +
        `1. Use Azure PostgreSQL: .database.azure.com or .postgres.database.azure.com\n` +
        `2. Set DEPLOYMENT_MODE=standalone for local testing\n`
    );
  }
}
