/**
 * Azure-Only Runtime Guard
 *
 * VaultSpace is designed to run exclusively in Azure.
 * This guard prevents local execution and ensures all runtime
 * dependencies point to Azure-hosted services.
 *
 * Policy: No local app, no local database, no local infrastructure.
 */

const AZURE_ONLY_ERROR = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   🚫 LOCAL EXECUTION BLOCKED                                                 ║
║                                                                              ║
║   VaultSpace is configured for Azure-only operation.                         ║
║   Local execution is not permitted.                                          ║
║                                                                              ║
║   To run VaultSpace:                                                         ║
║   1. Deploy to Azure Container Apps                                          ║
║   2. Use Azure PostgreSQL for database                                       ║
║   3. Use Azure Blob Storage for files                                        ║
║   4. Use Azure Cache for Redis                                               ║
║                                                                              ║
║   For development, use the staging environment in Azure.                     ║
║                                                                              ║
║   Local development is not supported on this branch.                         ║
║   Use the Azure staging environment for development.                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

/**
 * Check if a URL points to localhost
 */
function isLocalhost(url: string | undefined): boolean {
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
 * Check if running in a local development context
 */
function isLocalEnvironment(): boolean {
  // Check for explicit Azure deployment indicators
  const hasAzureIndicators =
    process.env['WEBSITE_SITE_NAME'] || // Azure App Service / Container Apps
    process.env['CONTAINER_APP_NAME'] || // Azure Container Apps
    process.env['AZURE_FUNCTIONS_ENVIRONMENT']; // Azure Functions

  if (hasAzureIndicators) {
    return false; // Running in Azure
  }

  // No local bypass - Azure-only policy is enforced on this branch

  // Check DATABASE_URL for localhost
  if (isLocalhost(process.env['DATABASE_URL'])) {
    return true;
  }

  // Check REDIS_URL for localhost
  if (isLocalhost(process.env['REDIS_URL'])) {
    return true;
  }

  // Check for typical local development indicators
  if (process.env['NODE_ENV'] === 'development' && !process.env['AZURE_DEPLOYMENT']) {
    return true;
  }

  return false;
}

/**
 * Enforce Azure-only execution
 * Call this at application startup to block local execution
 */
export function enforceAzureOnly(): void {
  if (isLocalEnvironment()) {
    console.error(AZURE_ONLY_ERROR);
    process.exit(1);
  }
}

/**
 * Validate that all required Azure configuration is present
 */
export function validateAzureConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check DATABASE_URL points to Azure PostgreSQL
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    errors.push('DATABASE_URL is not set');
  } else if (
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

  // Check AZURE_STORAGE_ACCOUNT is set
  if (!process.env['AZURE_STORAGE_ACCOUNT'] && !process.env['AZURE_STORAGE_CONNECTION_STRING']) {
    errors.push(
      'Azure Storage configuration is required (AZURE_STORAGE_ACCOUNT or AZURE_STORAGE_CONNECTION_STRING)'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Guard for integration tests - blocks tests that target localhost
 */
export function guardIntegrationTests(): void {
  const dbUrl = process.env['DATABASE_URL'] || '';

  if (isLocalhost(dbUrl)) {
    throw new Error(
      `\n\n` +
        `🚫 INTEGRATION TEST BLOCKED\n\n` +
        `Tests cannot run against localhost.\n` +
        `DATABASE_URL must point to Azure PostgreSQL.\n\n` +
        `Current DATABASE_URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}\n\n` +
        `Required: .database.azure.com or .postgres.database.azure.com\n`
    );
  }
}
