/**
 * Preview Job Processor
 *
 * Processes document preview generation jobs using the PreviewProvider.
 */

import { Job } from 'bullmq';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';

import type { PreviewGenerateJobPayload, ThumbnailGenerateJobPayload } from '../types';

export async function processPreviewJob(job: Job<PreviewGenerateJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, storageKey, contentType, fileName } = job.data;

  console.log(`[PreviewProcessor] Generating preview for document ${documentId}, version ${versionId}`);

  const providers = getProviders();

  // Update status to processing
  await db.documentVersion.update({
    where: { id: versionId },
    data: { previewStatus: 'PROCESSING' },
  });

  // Check if preview is supported for this content type
  if (!providers.preview.isSupported(contentType)) {
    console.log(`[PreviewProcessor] Content type ${contentType} not supported, marking unsupported`);

    await db.documentVersion.update({
      where: { id: versionId },
      data: {
        previewStatus: 'UNSUPPORTED',
        previewGeneratedAt: new Date(),
      },
    });

    // Queue search indexing directly (skip preview)
    await queueSearchIndex(providers, documentId, versionId, organizationId, fileName);
    return;
  }

  try {
    // Get file from storage (documents bucket stores original uploads)
    const fileBuffer = await providers.storage.get('documents', storageKey);

    // Convert to preview format
    const previewResult = await providers.preview.convert(fileBuffer, contentType, {
      format: 'pdf',
      quality: 90,
      dpi: 150,
    });

    // Store preview as PDF
    const previewKey = `previews/${documentId}/${versionId}.pdf`;
    const firstPage = previewResult.pages[0];
    if (firstPage) {
      await providers.storage.put('previews', previewKey, firstPage.data);

      // Create preview asset record
      await db.previewAsset.create({
        data: {
          organizationId,
          versionId,
          assetType: 'PDF',
          storageKey: previewKey,
          pageNumber: 1,
          mimeType: previewResult.mimeType,
          width: firstPage.width,
          height: firstPage.height,
          fileSizeBytes: BigInt(firstPage.data.length),
        },
      });
    }

    // Update document version with preview info
    await db.documentVersion.update({
      where: { id: versionId },
      data: {
        previewStatus: 'READY',
        previewGeneratedAt: new Date(),
      },
    });

    // Update document page count
    await db.document.update({
      where: { id: documentId },
      data: { totalVersions: { increment: 0 } }, // Touch for updatedAt
    });

    console.log(`[PreviewProcessor] Preview generated: ${previewResult.totalPages} pages`);

    // Queue thumbnail generation
    await providers.job.addJob(
      'high',
      'thumbnail.generate',
      {
        documentId,
        versionId,
        organizationId,
        previewKey,
        pageNumber: 1,
        width: 200,
        height: 280,
      } satisfies ThumbnailGenerateJobPayload,
      { priority: 'normal' }
    );

    // Queue text extraction
    await providers.job.addJob(
      'high',
      'text.extract',
      {
        documentId,
        versionId,
        organizationId,
        storageKey: previewKey,
        contentType: 'application/pdf',
        fileName,
        pageCount: previewResult.totalPages,
      },
      { priority: 'normal' }
    );
  } catch (error) {
    console.error(`[PreviewProcessor] Preview generation failed for document ${documentId}:`, error);

    await db.documentVersion.update({
      where: { id: versionId },
      data: {
        previewStatus: 'FAILED',
        previewError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

export async function processThumbnailJob(job: Job<ThumbnailGenerateJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, previewKey, width, height } = job.data;

  console.log(`[PreviewProcessor] Generating thumbnail for document ${documentId}`);

  const providers = getProviders();

  try {
    // Get preview file from previews bucket
    const previewBuffer = await providers.storage.get('previews', previewKey);

    // Generate thumbnail
    const thumbnailBuffer = await providers.preview.generateThumbnail(
      previewBuffer,
      'application/pdf',
      width,
      height
    );

    // Store thumbnail in previews bucket
    const thumbnailKey = `thumbnails/${documentId}/${versionId}.png`;
    await providers.storage.put('previews', thumbnailKey, thumbnailBuffer);

    // Create preview asset record for thumbnail
    await db.previewAsset.create({
      data: {
        organizationId,
        versionId,
        assetType: 'THUMBNAIL',
        storageKey: thumbnailKey,
        pageNumber: 1,
        mimeType: 'image/png',
        width,
        height,
        fileSizeBytes: BigInt(thumbnailBuffer.length),
      },
    });

    console.log(`[PreviewProcessor] Thumbnail generated: ${thumbnailKey}`);
  } catch (error) {
    console.error(`[PreviewProcessor] Thumbnail generation failed for document ${documentId}:`, error);
    // Don't throw - thumbnail failure is non-critical
    console.log(`[PreviewProcessor] Continuing without thumbnail`);
  }
}

// Helper to queue search indexing
async function queueSearchIndex(
  providers: ReturnType<typeof getProviders>,
  documentId: string,
  versionId: string,
  organizationId: string,
  fileName: string
): Promise<void> {
  const document = await db.document.findFirst({
    where: { id: documentId, organizationId },
    select: { roomId: true },
  });

  if (document) {
    await providers.job.addJob(
      'normal',
      'search.index',
      {
        documentId,
        versionId,
        organizationId,
        roomId: document.roomId,
        fileName,
        text: '', // No extracted text
      },
      { priority: 'normal' }
    );
  }
}
