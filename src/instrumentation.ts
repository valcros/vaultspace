/**
 * Next.js Instrumentation
 *
 * This file runs during Next.js server startup.
 * Used to enforce deployment mode policy and log capabilities.
 */

export async function register() {
  // Only run server-side
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { enforceDeploymentMode, validateConfig } = await import('@/lib/azure-guard');
    const { getDeploymentMode } = await import('@/lib/deployment-mode');
    const { resolveCapabilities, getDegradedCapabilities } = await import(
      '@/lib/deployment-capabilities'
    );

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
      process.exit(1);
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
  }
}
