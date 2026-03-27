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

  console.log(
    `[PreviewProcessor] Generating preview for document ${documentId}, version ${versionId}`
  );

  const providers = getProviders();

  // Update status to processing
  await db.documentVersion.update({
    where: { id: versionId },
    data: { previewStatus: 'PROCESSING' },
  });

  // Check if preview is supported for this content type
  if (!providers.preview.isSupported(contentType)) {
    console.log(
      `[PreviewProcessor] Content type ${contentType} not supported, marking unsupported`
    );

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

    // Convert to preview format (PNG for page renders)
    const previewResult = await providers.preview.convert(fileBuffer, contentType, {
      format: 'png',
      quality: 90,
      dpi: 150,
    });

    // Store each page as a preview asset
    for (const page of previewResult.pages) {
      const ext = page.mimeType === 'application/pdf' ? 'pdf' : 'png';
      const assetType = page.mimeType === 'application/pdf' ? 'PDF' : 'RENDER';
      const renderKey = `previews/${documentId}/${versionId}/page-${page.pageNumber}.${ext}`;
      await providers.storage.put('previews', renderKey, page.data);

      // Create preview asset record for each page
      await db.previewAsset.create({
        data: {
          organizationId,
          versionId,
          assetType,
          storageKey: renderKey,
          pageNumber: page.pageNumber,
          mimeType: page.mimeType,
          width: page.width,
          height: page.height,
          fileSizeBytes: BigInt(page.data.length),
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

    console.log(
      `[PreviewProcessor] Preview generated: ${previewResult.totalPages} pages, created ${previewResult.pages.length} RENDER assets`
    );

    // Queue thumbnail generation using the first page render
    const firstPageKey = `previews/${documentId}/${versionId}/page-1.png`;
    await providers.job.addJob(
      'high',
      'thumbnail.generate',
      {
        documentId,
        versionId,
        organizationId,
        previewKey: firstPageKey,
        pageNumber: 1,
        width: 200,
        height: 280,
      } satisfies ThumbnailGenerateJobPayload,
      { priority: 'normal' }
    );

    // Queue text extraction using the original document
    await providers.job.addJob(
      'high',
      'text.extract',
      {
        documentId,
        versionId,
        organizationId,
        storageKey,
        contentType,
        fileName,
        pageCount: previewResult.totalPages,
      },
      { priority: 'normal' }
    );
  } catch (error) {
    console.error(
      `[PreviewProcessor] Preview generation failed for document ${documentId}:`,
      error
    );

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

    // Generate thumbnail (preview is now a PNG image, not PDF)
    const thumbnailBuffer = await providers.preview.generateThumbnail(
      previewBuffer,
      'image/png',
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
    console.error(
      `[PreviewProcessor] Thumbnail generation failed for document ${documentId}:`,
      error
    );
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
