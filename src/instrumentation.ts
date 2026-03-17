/**
 * Next.js Instrumentation
 *
 * This file runs during Next.js server startup.
 * Used to enforce Azure-only runtime policy.
 */

export async function register() {
  // Only run server-side
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { enforceAzureOnly, validateAzureConfig } = await import('@/lib/azure-guard');

    // Block local execution
    enforceAzureOnly();

    // Validate Azure configuration - fail fast if not properly configured
    const { valid, errors } = validateAzureConfig();
    if (!valid) {
      console.error('[Azure Guard] ❌ STARTUP BLOCKED - Missing required Azure configuration:');
      errors.forEach((err) => console.error(`  - ${err}`));
      console.error('\nVaultSpace requires properly configured Azure services.');
      console.error('See DEPLOYMENT.md for Azure configuration requirements.\n');
      process.exit(1);
    }
  }
}
