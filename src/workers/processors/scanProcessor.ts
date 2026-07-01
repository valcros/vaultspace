/**
 * Scan Job Processor
 *
 * Processes document virus scanning jobs using the ScanProvider.
 */

import { Job } from 'bullmq';

import { withOrgContext } from '@/lib/db';
import { createEventBus } from '@/lib/events/EventBus';
import { getProviders } from '@/providers';

import type { ScanJobPayload } from '../types';

const DEFAULT_SCANNER_READY_TIMEOUT_MS = 120000;
const DEFAULT_SCANNER_READY_POLL_MS = 5000;

function isFinalAttempt(job: Job<ScanJobPayload>): boolean {
  const maxAttempts = job.opts.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= maxAttempts;
}

function scannerRequired(): boolean {
  return process.env['SCAN_ENGINE']?.toLowerCase() === 'clamav' || !!process.env['CLAMAV_HOST'];
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScannerReady(isAvailable: () => Promise<boolean>): Promise<boolean> {
  const timeoutMs = parseNonNegativeInteger(
    process.env['CLAMAV_READY_TIMEOUT_MS'],
    DEFAULT_SCANNER_READY_TIMEOUT_MS
  );
  const pollMs = Math.max(
    100,
    parseNonNegativeInteger(process.env['CLAMAV_READY_POLL_MS'], DEFAULT_SCANNER_READY_POLL_MS)
  );

  if (timeoutMs <= 0) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  let attempt = 1;

  console.warn(
    `[ScanProcessor] Required virus scanner is not available; waiting up to ${timeoutMs}ms`
  );

  while (Date.now() < deadline) {
    const delay = Math.min(pollMs, Math.max(0, deadline - Date.now()));
    if (delay > 0) {
      await sleep(delay);
    }

    attempt += 1;
    if (await isAvailable()) {
      console.log(`[ScanProcessor] Virus scanner became available after ${attempt} checks`);
      return true;
    }
  }

  return false;
}

async function markRetryableScanFailure(
  job: Job<ScanJobPayload>,
  error: Error,
  finalAttempt: boolean
): Promise<void> {
  await withOrgContext(job.data.organizationId, async (tx) => {
    await tx.documentVersion.update({
      where: {
        id: job.data.versionId,
      },
      data: finalAttempt
        ? {
            scanStatus: 'ERROR',
            scanError: error.message,
          }
        : {
            scanStatus: 'PENDING',
            scanError: null,
            scannedAt: null,
          },
    });
  });
}

export async function processScanJob(job: Job<ScanJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, storageKey } = job.data;

  console.log(`[ScanProcessor] Starting scan for document ${documentId}, version ${versionId}`);

  const providers = getProviders();

  // Check if scanner is available
  let scannerAvailable = await providers.scan.isAvailable();

  if (!scannerAvailable && scannerRequired()) {
    scannerAvailable = await waitForScannerReady(() => providers.scan.isAvailable());

    if (!scannerAvailable) {
      const error = new Error('Configured virus scanner is not available');
      console.error(`[ScanProcessor] ${error.message}`);

      await markRetryableScanFailure(job, error, isFinalAttempt(job));
      throw error;
    }
  }

  if (!scannerAvailable) {
    console.log(`[ScanProcessor] Scanner not available, marking as clean (development mode)`);

    // In development without ClamAV, mark as clean
    await withOrgContext(organizationId, async (tx) => {
      await tx.documentVersion.update({
        where: {
          id: versionId,
        },
        data: {
          scanStatus: 'CLEAN',
          scannedAt: new Date(),
        },
      });
    });

    // Queue preview generation job
    await providers.job.addJob('high', 'preview.generate', {
      documentId,
      versionId,
      organizationId,
      storageKey,
      fileName: job.data.fileName,
      contentType: job.data.contentType,
      fileSizeBytes: job.data.fileSizeBytes,
      isScanned: false,
    });

    return;
  }

  try {
    // Get file from storage (documents bucket stores original uploads)
    const fileBuffer = await providers.storage.get('documents', storageKey);

    // Scan file
    const scanResult = await providers.scan.scan(fileBuffer);

    if (scanResult.clean) {
      console.log(`[ScanProcessor] Document ${documentId} is clean`);

      await withOrgContext(organizationId, async (tx) => {
        await tx.documentVersion.update({
          where: {
            id: versionId,
          },
          data: {
            scanStatus: 'CLEAN',
            scannedAt: new Date(),
          },
        });
      });

      // Queue preview generation job
      await providers.job.addJob('high', 'preview.generate', {
        documentId,
        versionId,
        organizationId,
        storageKey,
        fileName: job.data.fileName,
        contentType: job.data.contentType,
        fileSizeBytes: job.data.fileSizeBytes,
        isScanned: false,
      });
    } else {
      console.log(
        `[ScanProcessor] Document ${documentId} is INFECTED: ${scanResult.threats?.join(', ')}`
      );

      const { document, admins } = await withOrgContext(organizationId, async (tx) => {
        await tx.documentVersion.update({
          where: {
            id: versionId,
          },
          data: {
            scanStatus: 'INFECTED',
            scanError: `Threats detected: ${scanResult.threats?.join(', ')}`,
            scannedAt: new Date(),
          },
        });

        const [documentRecord, adminRecords] = await Promise.all([
          tx.document.findFirst({
            where: { id: documentId, organizationId },
            select: { roomId: true },
          }),
          tx.userOrganization.findMany({
            where: { organizationId, role: 'ADMIN', isActive: true },
            include: { user: { select: { email: true, firstName: true } } },
          }),
        ]);

        return { document: documentRecord, admins: adminRecords };
      });

      // Emit DOCUMENT_SCANNED event for audit trail
      const eventBus = createEventBus(organizationId, { actorType: 'SYSTEM' });

      await eventBus.emit('DOCUMENT_SCANNED', {
        roomId: document?.roomId,
        documentId,
        metadata: {
          versionId,
          scanStatus: 'INFECTED',
          threats: scanResult.threats ?? [],
        },
      });

      // Notify organization admins
      for (const admin of admins) {
        if (!admin.user.email) {
          continue;
        }
        try {
          await providers.email.sendEmail({
            to: admin.user.email,
            subject: 'Security Alert: Infected file detected',
            html: `<p>Hi ${admin.user.firstName ?? 'Admin'},</p>
<p>A file uploaded to your VaultSpace organization has been flagged as infected and blocked from use.</p>
<ul>
  <li><strong>File:</strong> ${job.data.fileName}</li>
  <li><strong>Threats:</strong> ${scanResult.threats?.join(', ') ?? 'Unknown'}</li>
</ul>
<p>The file has been quarantined and will not be accessible to viewers.</p>`,
          });
        } catch (emailError) {
          console.error(`[ScanProcessor] Failed to notify admin ${admin.user.email}:`, emailError);
        }
      }
    }
  } catch (error) {
    console.error(`[ScanProcessor] Scan failed for document ${documentId}:`, error);

    const scanError = error instanceof Error ? error : new Error('Unknown error');
    await markRetryableScanFailure(job, scanError, isFinalAttempt(job));

    throw error; // Re-throw for BullMQ retry handling
  }
}
