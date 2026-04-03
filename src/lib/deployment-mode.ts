/**
 * Deployment Mode Detection
 *
 * VaultSpace supports two deployment modes:
 * - azure: Enforces Azure services. Blocks startup if misconfigured. (default)
 * - standalone: Allows non-Azure services. Explicit provider configuration required.
 *
 * Set via DEPLOYMENT_MODE environment variable.
 */

export type DeploymentMode = 'azure' | 'standalone';

/**
 * Get the current deployment mode.
 * Defaults to 'azure' (fail-closed) if not specified.
 */
export function getDeploymentMode(): DeploymentMode {
  const mode = process.env['DEPLOYMENT_MODE']?.toLowerCase();

  if (mode === 'standalone') {
    return 'standalone';
  }

  // Default to 'azure' for fail-closed behavior
  return 'azure';
}

/**
 * Check if running in Azure-only mode.
 * In this mode, all services must be Azure-hosted.
 */
export function isAzureMode(): boolean {
  return getDeploymentMode() === 'azure';
}

/**
 * Check if running in standalone mode.
 * In this mode, non-Azure services are allowed.
 */
export function isStandaloneMode(): boolean {
  return getDeploymentMode() === 'standalone';
}
