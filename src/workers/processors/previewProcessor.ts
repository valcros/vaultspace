/**
 * Preview Job Processor
 *
 * Processes document preview generation jobs using the PreviewProvider.
 * Generates thumbnails inline from original file bytes (not from preview output).
 */

import { Job } from 'bullmq';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';

import type { PreviewGenerateJobPayload, ThumbnailGenerateJobPayload } from '../types';

/** Max file size for proactive thumbnail generation (25MB) */
const THUMBNAIL_SIZE_LIMIT = 25 * 1024 * 1024;

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

    // Generate thumbnail inline from original file bytes (not from preview output).
    // Skip proactive generation for large files — on-demand API handles them.
    if (fileBuffer.length <= THUMBNAIL_SIZE_LIMIT) {
      try {
        const thumbnailBuffer = await providers.preview.generateThumbnailPng(
          fileBuffer,
          contentType,
          fileName,
          200,
          280
        );

        if (thumbnailBuffer.length > 0) {
          const thumbnailKey = `thumbnails/${documentId}/${versionId}.png`;
          await providers.storage.put('previews', thumbnailKey, thumbnailBuffer);

          // Upsert thumbnail asset (idempotent — safe for concurrent/retry)
          await db.previewAsset.upsert({
            where: {
              versionId_assetType_pageNumber: {
                versionId,
                assetType: 'THUMBNAIL',
                pageNumber: 1,
              },
            },
            create: {
              organizationId,
              versionId,
              assetType: 'THUMBNAIL',
              storageKey: thumbnailKey,
              pageNumber: 1,
              mimeType: 'image/png',
              width: 200,
              height: 280,
              fileSizeBytes: BigInt(thumbnailBuffer.length),
            },
            update: {
              storageKey: thumbnailKey,
              mimeType: 'image/png',
              width: 200,
              height: 280,
              fileSizeBytes: BigInt(thumbnailBuffer.length),
            },
          });

          console.log(`[PreviewProcessor] Thumbnail generated inline: ${thumbnailKey}`);
        }
      } catch (thumbError) {
        // Thumbnail failure is non-critical — on-demand API handles failures
        console.error(
          `[PreviewProcessor] Inline thumbnail generation failed for ${documentId}:`,
          thumbError
        );
      }
    } else {
      console.log(
        `[PreviewProcessor] Skipping proactive thumbnail for ${documentId} (${fileBuffer.length} bytes > ${THUMBNAIL_SIZE_LIMIT})`
      );
    }

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

/**
 * @deprecated Use inline thumbnail generation in processPreviewJob instead.
 * Kept for backward compatibility with jobs already in the queue.
 */
export async function processThumbnailJob(job: Job<ThumbnailGenerateJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, previewKey, width, height } = job.data;

  console.log(`[PreviewProcessor] Processing legacy thumbnail job for document ${documentId}`);

  const providers = getProviders();

  try {
    // Get preview file from previews bucket
    const previewBuffer = await providers.storage.get('previews', previewKey);

    // If the preview is a PDF (from Gotenberg), rasterize to PNG first
    let imageBuffer: Buffer;
    const isPdf = previewKey.endsWith('.pdf');
    if (isPdf) {
      const sharp = (await import('sharp')).default;
      try {
        // Sharp can rasterize PDFs if libvips has poppler support
        imageBuffer = await sharp(Buffer.from(previewBuffer), { density: 150 }).png().toBuffer();
      } catch {
        // Fallback: create a placeholder thumbnail for PDF previews
        imageBuffer = await sharp({
          create: {
            width: width * 2,
            height: height * 2,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        })
          .composite([
            {
              input: Buffer.from(
                `<svg width="${width * 2}" height="${height * 2}">
                  <rect width="100%" height="100%" fill="white" stroke="#e5e7eb" stroke-width="2" rx="8"/>
                  <text x="50%" y="45%" text-anchor="middle" font-family="system-ui" font-size="24" fill="#6b7280">PDF</text>
                  <text x="50%" y="55%" text-anchor="middle" font-family="system-ui" font-size="14" fill="#9ca3af">Preview</text>
                </svg>`
              ),
              top: 0,
              left: 0,
            },
          ])
          .png()
          .toBuffer();
      }
    } else {
      imageBuffer = Buffer.from(previewBuffer);
    }

    // Generate thumbnail from the rasterized image
    const thumbnailBuffer = await providers.preview.generateThumbnail(
      imageBuffer,
      'image/png',
      width,
      height
    );

    // Store thumbnail in previews bucket
    const thumbnailKey = `thumbnails/${documentId}/${versionId}.png`;
    await providers.storage.put('previews', thumbnailKey, thumbnailBuffer);

    // Upsert thumbnail asset (idempotent)
    await db.previewAsset.upsert({
      where: {
        versionId_assetType_pageNumber: {
          versionId,
          assetType: 'THUMBNAIL',
          pageNumber: 1,
        },
      },
      create: {
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
      update: {
        storageKey: thumbnailKey,
        mimeType: 'image/png',
        width,
        height,
        fileSizeBytes: BigInt(thumbnailBuffer.length),
      },
    });

    console.log(`[PreviewProcessor] Legacy thumbnail generated: ${thumbnailKey}`);
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
