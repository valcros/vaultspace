/**
 * Deployment Capabilities
 *
 * Determines which features are available based on infrastructure configuration.
 * Used to gracefully degrade functionality when optional services are unavailable.
 */

// Note: Capabilities are determined by infrastructure availability, not deployment mode.
// Both Azure and standalone modes use the same capability resolution logic.

/**
 * Capabilities available in the current deployment.
 */
export interface DeploymentCapabilities {
  // Core infrastructure
  canQueueJobs: boolean;
  canUseDistributedCache: boolean;

  // Document processing
  canGenerateAsyncPreviews: boolean;
  canGenerateSyncPreviews: boolean;
  canRunVirusScanning: boolean;
  canGenerateThumbnails: boolean;

  // Notifications
  canSendAsyncEmail: boolean;
  canSendSyncEmail: boolean;

  // Batch operations
  canRunScheduledReports: boolean;
  canRunBulkExport: boolean;
  canRunBulkOperations: boolean;
}

/**
 * Custom error for unavailable capabilities.
 * Consumers should catch this and return 503 Service Unavailable.
 */
export class CapabilityUnavailableError extends Error {
  public readonly capability: keyof DeploymentCapabilities;
  public readonly statusCode = 503;

  constructor(capability: keyof DeploymentCapabilities, message?: string) {
    super(
      message ||
        `Capability '${capability}' is not available in the current deployment configuration`
    );
    this.name = 'CapabilityUnavailableError';
    this.capability = capability;
  }
}

/**
 * Check if Redis is configured.
 */
function hasRedis(): boolean {
  return !!process.env['REDIS_URL'];
}

/**
 * Check if ClamAV is configured.
 */
function hasClamAV(): boolean {
  return !!process.env['CLAMAV_HOST'];
}

/**
 * Check if the scan engine is intentionally bypassed.
 * SCAN_ENGINE=passthrough is a deliberate operational choice (e.g. staging without ClamAV)
 * and is treated as a configured scanning capability, not a missing dependency.
 */
function isScanPassthrough(): boolean {
  return process.env['SCAN_ENGINE']?.toLowerCase() === 'passthrough';
}

/**
 * Check if Gotenberg is configured.
 */
function hasGotenberg(): boolean {
  return !!process.env['GOTENBERG_URL'];
}

/**
 * Check if SMTP is configured.
 */
function hasSmtp(): boolean {
  return !!(process.env['SMTP_HOST'] || process.env['SMTP_URL']);
}

/**
 * Check if Azure Communication Services email is configured.
 * Matches the resolution logic in src/providers/index.ts.
 */
function hasAcsEmail(): boolean {
  return (
    process.env['EMAIL_PROVIDER']?.toLowerCase() === 'acs' && !!process.env['ACS_CONNECTION_STRING']
  );
}

/**
 * Check whether any email transport is configured (SMTP or ACS).
 */
function hasEmail(): boolean {
  return hasSmtp() || hasAcsEmail();
}

/**
 * Resolve capabilities based on current infrastructure configuration.
 */
export function resolveCapabilities(): DeploymentCapabilities {
  const redis = hasRedis();
  const clamav = hasClamAV();
  const scanPassthrough = isScanPassthrough();
  const gotenberg = hasGotenberg();
  const email = hasEmail();

  // Redis is required for job queue in both modes
  const hasJobQueue = redis;

  return {
    // Core infrastructure
    canQueueJobs: hasJobQueue,
    canUseDistributedCache: redis,

    // Document processing
    // Async previews require job queue (Redis)
    canGenerateAsyncPreviews: hasJobQueue && gotenberg,
    // Sync previews work for images via Sharp, even without Gotenberg
    canGenerateSyncPreviews: true,
    // Virus scanning requires job queue plus either ClamAV or an explicit passthrough opt-in
    canRunVirusScanning: hasJobQueue && (clamav || scanPassthrough),
    // Thumbnails can be generated synchronously via Sharp
    canGenerateThumbnails: true,

    // Notifications
    // Async email requires job queue + an email transport (SMTP or ACS)
    canSendAsyncEmail: hasJobQueue && email,
    // Sync email just needs an email transport
    canSendSyncEmail: email,

    // Batch operations - all require job queue
    canRunScheduledReports: hasJobQueue,
    canRunBulkExport: hasJobQueue,
    canRunBulkOperations: hasJobQueue,
  };
}

/**
 * Require a capability to be available.
 * Throws CapabilityUnavailableError if not available.
 */
export function requireCapability(capability: keyof DeploymentCapabilities): void {
  const capabilities = resolveCapabilities();
  if (!capabilities[capability]) {
    throw new CapabilityUnavailableError(capability);
  }
}

/**
 * Check if a capability is available without throwing.
 */
export function hasCapability(capability: keyof DeploymentCapabilities): boolean {
  const capabilities = resolveCapabilities();
  return capabilities[capability];
}

/**
 * Get list of degraded capabilities (configured but missing dependencies).
 */
export function getDegradedCapabilities(): (keyof DeploymentCapabilities)[] {
  const capabilities = resolveCapabilities();
  const degraded: (keyof DeploymentCapabilities)[] = [];

  // Check for expected capabilities that are unavailable
  const expectedInProduction: (keyof DeploymentCapabilities)[] = [
    'canQueueJobs',
    'canRunVirusScanning',
    'canGenerateAsyncPreviews',
    'canSendAsyncEmail',
  ];

  for (const cap of expectedInProduction) {
    if (!capabilities[cap]) {
      degraded.push(cap);
    }
  }

  return degraded;
}

/**
 * Get a human-readable description of why a capability is unavailable.
 */
export function getCapabilityUnavailableReason(
  capability: keyof DeploymentCapabilities
): string | null {
  const redis = hasRedis();
  const clamav = hasClamAV();
  const scanPassthrough = isScanPassthrough();
  const gotenberg = hasGotenberg();
  const email = hasEmail();

  switch (capability) {
    case 'canQueueJobs':
    case 'canUseDistributedCache':
      return redis ? null : 'Redis is not configured (REDIS_URL)';

    case 'canGenerateAsyncPreviews':
      if (!redis) {
        return 'Redis is not configured (REDIS_URL)';
      }
      if (!gotenberg) {
        return 'Gotenberg is not configured (GOTENBERG_URL)';
      }
      return null;

    case 'canRunVirusScanning':
      if (!redis) {
        return 'Redis is not configured (REDIS_URL)';
      }
      if (!clamav && !scanPassthrough) {
        return 'No scan engine configured (set CLAMAV_HOST or SCAN_ENGINE=passthrough)';
      }
      return null;

    case 'canSendAsyncEmail':
      if (!redis) {
        return 'Redis is not configured (REDIS_URL)';
      }
      if (!email) {
        return 'No email transport configured (set SMTP_HOST or EMAIL_PROVIDER=acs with ACS_CONNECTION_STRING)';
      }
      return null;

    case 'canSendSyncEmail':
      return email
        ? null
        : 'No email transport configured (set SMTP_HOST or EMAIL_PROVIDER=acs with ACS_CONNECTION_STRING)';

    case 'canRunScheduledReports':
    case 'canRunBulkExport':
    case 'canRunBulkOperations':
      return redis ? null : 'Redis is not configured (REDIS_URL)';

    default:
      return null;
  }
}

/**
 * Create a NextResponse for a 503 Service Unavailable error
 * when a capability is not available.
 */
export function createCapabilityUnavailableResponse(
  capability: keyof DeploymentCapabilities,
  featureName: string
): Response {
  const reason = getCapabilityUnavailableReason(capability);

  return new Response(
    JSON.stringify({
      error: 'Service Unavailable',
      code: 'CAPABILITY_UNAVAILABLE',
      message: `${featureName} is not available in the current deployment configuration.`,
      capability,
      reason: reason || 'Required infrastructure is not configured',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '3600', // Suggest retry in 1 hour (configuration change needed)
      },
    }
  );
}
