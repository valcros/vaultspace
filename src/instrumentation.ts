/* eslint-disable no-console */

/**
 * Next.js Instrumentation
 *
 * This file runs during Next.js server startup.
 * Used to enforce deployment mode policy and log capabilities.
 */

import { installBigIntJsonSerializer } from '@/lib/bigint-json';

// Install the process-wide BigInt JSON serializer before any request is served
// so no API response can 500 on an unserialized BigInt (byte counts etc.).
// Called (not bare-imported) so it is not tree-shaken from the bundle.
installBigIntJsonSerializer();

export async function register() {
  // Only run server-side
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { enforceDeploymentMode, validateConfig } = await import('@/lib/azure-guard');
    const { getDeploymentMode } = await import('@/lib/deployment-mode');
    const { resolveCapabilities, getDegradedCapabilities } =
      await import('@/lib/deployment-capabilities');

    const mode = getDeploymentMode();

    // Enforce deployment mode restrictions
    enforceDeploymentMode();

    // Validate configuration based on mode
    const { valid, errors, warnings } = validateConfig();
    if (!valid) {
      console.error(
        `[DeploymentGuard] STARTUP BLOCKED - Missing required configuration for ${mode} mode:`
      );
      errors.forEach((err) => console.error(`  - ${err}`));
      console.error('\nSee DEPLOYMENT.md for configuration requirements.\n');
      throw new Error(`[DeploymentGuard] Invalid ${mode} configuration`);
    }

    // Log warnings (but don't block startup)
    if (warnings.length > 0) {
      console.warn(`[DeploymentGuard] Configuration warnings:`);
      warnings.forEach((warn) => console.warn(`  - ${warn}`));
    }

    // Log capabilities
    const capabilities = resolveCapabilities();
    const degraded = getDegradedCapabilities();

    console.log(`[DeploymentGuard] Deployment mode: ${mode}`);
    console.log(`[DeploymentGuard] Capabilities:`);
    console.log(`  - Job queue: ${capabilities.canQueueJobs ? 'available' : 'unavailable'}`);
    console.log(
      `  - Async previews: ${capabilities.canGenerateAsyncPreviews ? 'available' : 'unavailable'}`
    );
    console.log(
      `  - Virus scanning: ${capabilities.canRunVirusScanning ? 'available' : 'unavailable'}`
    );
    console.log(`  - Async email: ${capabilities.canSendAsyncEmail ? 'available' : 'unavailable'}`);

    if (degraded.length > 0) {
      console.warn(`[DeploymentGuard] Degraded capabilities: ${degraded.join(', ')}`);
    }

    // Security warning if virus scanning unavailable
    if (!capabilities.canRunVirusScanning) {
      console.warn(
        `[Security] Virus scanning unavailable - uploads will not be scanned. ` +
          `Configure CLAMAV_HOST and REDIS_URL to enable scanning.`
      );
    }

    // Verify runtime DB role does not bypass RLS
    const { checkRlsRole } = await import('@/lib/rls-startup-guard');
    const rlsResult = await checkRlsRole();
    if (rlsResult.status === 'bypassing') {
      const msg =
        `[RLSGuard] Runtime database role '${rlsResult.roleName}' has BYPASSRLS — ` +
        `tenant isolation is not enforced at the database layer. ` +
        `Create a restricted role (NOCREATEDB NOCREATEROLE NOBYPASSRLS) for DATABASE_URL ` +
        `and reserve DATABASE_URL_ADMIN for the privileged role.`;
      if (mode === 'azure') {
        throw new Error(msg);
      } else {
        console.warn(msg);
      }
    } else if (rlsResult.status === 'error') {
      console.warn(`[RLSGuard] Could not verify database role: ${rlsResult.message}`);
    } else {
      console.log(`[RLSGuard] Runtime role '${rlsResult.roleName}' NOBYPASSRLS — OK`);
    }
  }
}
