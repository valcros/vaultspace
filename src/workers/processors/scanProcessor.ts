/**
 * Scan Job Processor
 *
 * Processes document virus scanning jobs using the ScanProvider.
 */

import { Job } from 'bullmq';

import { db } from '@/lib/db';
import { createEventBus } from '@/lib/events/EventBus';
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
      console.log(
        `[ScanProcessor] Document ${documentId} is INFECTED: ${scanResult.threats?.join(', ')}`
      );

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

      // Emit DOCUMENT_SCANNED event for audit trail
      const eventBus = createEventBus(organizationId, { actorType: 'SYSTEM' });
      const document = await db.document.findFirst({
        where: { id: documentId, organizationId },
        select: { roomId: true },
      });

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
      const admins = await db.userOrganization.findMany({
        where: { organizationId, role: 'ADMIN', isActive: true },
        include: { user: { select: { email: true, firstName: true } } },
      });

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
