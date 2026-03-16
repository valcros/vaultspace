/**
 * Scan Job Processor
 *
 * Processes document virus scanning jobs using the ScanProvider.
 */

import { Job } from 'bullmq';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';

import type { ScanJobPayload } from '../types';

export async function processScanJob(job: Job<ScanJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, storageKey } = job.data;

  console.log(`[ScanProcessor] Starting scan for document ${documentId}, version ${versionId}`);

  const providers = getProviders();

  // Check if scanner is available
  const scannerAvailable = await providers.scan.isAvailable();

  if (!scannerAvailable) {
    console.log(`[ScanProcessor] Scanner not available, marking as clean (development mode)`);

    // In development without ClamAV, mark as clean
    await db.documentVersion.update({
      where: {
        id: versionId,
      },
      data: {
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });

    // Queue preview generation job
    await providers.job.addJob(
      'high',
      'preview.generate',
      {
        documentId,
        versionId,
        organizationId,
        storageKey,
        fileName: job.data.fileName,
        contentType: job.data.contentType,
        fileSizeBytes: job.data.fileSizeBytes,
        isScanned: false,
      },
      { priority: 'high' }
    );

    return;
  }

  try {
    // Get file from storage (documents bucket stores original uploads)
    const fileBuffer = await providers.storage.get('documents', storageKey);

    // Scan file
    const scanResult = await providers.scan.scan(fileBuffer);

    if (scanResult.clean) {
      console.log(`[ScanProcessor] Document ${documentId} is clean`);

      await db.documentVersion.update({
        where: {
          id: versionId,
        },
        data: {
          scanStatus: 'CLEAN',
          scannedAt: new Date(),
        },
      });

      // Queue preview generation job
      await providers.job.addJob(
        'high',
        'preview.generate',
        {
          documentId,
          versionId,
          organizationId,
          storageKey,
          fileName: job.data.fileName,
          contentType: job.data.contentType,
          fileSizeBytes: job.data.fileSizeBytes,
          isScanned: false,
        },
        { priority: 'high' }
      );
    } else {
      console.log(`[ScanProcessor] Document ${documentId} is INFECTED: ${scanResult.threats?.join(', ')}`);

      await db.documentVersion.update({
        where: {
          id: versionId,
        },
        data: {
          scanStatus: 'INFECTED',
          scanError: `Threats detected: ${scanResult.threats?.join(', ')}`,
          scannedAt: new Date(),
        },
      });

      // TODO: Emit document.flagged_infected event
      // TODO: Notify room admin
    }
  } catch (error) {
    console.error(`[ScanProcessor] Scan failed for document ${documentId}:`, error);

    // Mark as error for retry
    await db.documentVersion.update({
      where: {
        id: versionId,
      },
      data: {
        scanStatus: 'ERROR',
        scanError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error; // Re-throw for BullMQ retry handling
  }
}
