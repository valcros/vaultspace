/**
 * Deployment Capabilities
 *
 * Determines which features are available based on infrastructure configuration.
 * Used to gracefully degrade functionality when optional services are unavailable.
 */

import { getDeploymentMode, isAzureMode } from './deployment-mode';

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
 * Resolve capabilities based on current infrastructure configuration.
 */
export function resolveCapabilities(): DeploymentCapabilities {
  const mode = getDeploymentMode();
  const redis = hasRedis();
  const clamav = hasClamAV();
  const gotenberg = hasGotenberg();
  const smtp = hasSmtp();

  // In Azure mode, Redis is always expected to be available
  // In standalone mode, Redis is recommended but optional
  const hasJobQueue = isAzureMode() ? redis : redis;

  return {
    // Core infrastructure
    canQueueJobs: hasJobQueue,
    canUseDistributedCache: redis,

    // Document processing
    // Async previews require job queue (Redis)
    canGenerateAsyncPreviews: hasJobQueue && gotenberg,
    // Sync previews work for images via Sharp, even without Gotenberg
    canGenerateSyncPreviews: true,
    // Virus scanning requires both ClamAV and job queue
    canRunVirusScanning: hasJobQueue && clamav,
    // Thumbnails can be generated synchronously via Sharp
    canGenerateThumbnails: true,

    // Notifications
    // Async email requires job queue
    canSendAsyncEmail: hasJobQueue && smtp,
    // Sync email just needs SMTP
    canSendSyncEmail: smtp,

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
  const gotenberg = hasGotenberg();
  const smtp = hasSmtp();

  switch (capability) {
    case 'canQueueJobs':
    case 'canUseDistributedCache':
      return redis ? null : 'Redis is not configured (REDIS_URL)';

    case 'canGenerateAsyncPreviews':
      if (!redis) return 'Redis is not configured (REDIS_URL)';
      if (!gotenberg) return 'Gotenberg is not configured (GOTENBERG_URL)';
      return null;

    case 'canRunVirusScanning':
      if (!redis) return 'Redis is not configured (REDIS_URL)';
      if (!clamav) return 'ClamAV is not configured (CLAMAV_HOST)';
      return null;

    case 'canSendAsyncEmail':
      if (!redis) return 'Redis is not configured (REDIS_URL)';
      if (!smtp) return 'SMTP is not configured (SMTP_HOST)';
      return null;

    case 'canSendSyncEmail':
      return smtp ? null : 'SMTP is not configured (SMTP_HOST)';

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
