/**
 * Text Extraction Job Processor
 *
 * Processes text extraction jobs for search indexing.
 */

import { Job } from 'bullmq';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';

import type { SearchIndexJobPayload, TextExtractJobPayload } from '../types';

export async function processTextExtractJob(job: Job<TextExtractJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, storageKey, contentType, fileName: _fileName } = job.data;

  console.log(`[TextProcessor] Extracting text for document ${documentId}, version ${versionId}`);

  const providers = getProviders();

  try {
    // Get file from storage
    const fileBuffer = await providers.storage.get(organizationId, storageKey);

    // For now, we use a simplified text extraction
    // In production, this would use OCR or PDF text extraction
    let extractedText = '';
    let detectedLanguage: string | null = null;

    // Check content type and extract accordingly
    if (contentType === 'text/plain') {
      extractedText = fileBuffer.toString('utf-8');
      detectedLanguage = 'en'; // Simplified
    } else if (contentType === 'application/pdf') {
      // PDF text extraction would go here (stub)
      extractedText = '';
    } else {
      // Other formats - would use preview provider (stub)
      extractedText = '';
    }

    // Create or update extracted text record
    await db.extractedText.upsert({
      where: { versionId },
      create: {
        organizationId,
        versionId,
        plainText: extractedText,
        detectedLanguage,
        confidence: detectedLanguage ? 0.9 : null,
      },
      update: {
        plainText: extractedText,
        detectedLanguage,
        confidence: detectedLanguage ? 0.9 : null,
      },
    });

    console.log(`[TextProcessor] Text extracted: ${extractedText.length} characters`);

    // Get document for room info
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      select: {
        roomId: true,
        name: true,
      },
    });

    if (document) {
      // Queue search indexing
      await providers.job.addJob(
        'normal',
        'search.index',
        {
          documentId,
          versionId,
          organizationId,
          roomId: document.roomId,
          fileName: document.name,
          text: extractedText,
          metadata: {
            pageCount: job.data.pageCount,
          },
        } satisfies SearchIndexJobPayload,
        { priority: 'normal' }
      );
    }
  } catch (error) {
    console.error(`[TextProcessor] Text extraction failed for document ${documentId}:`, error);
    // Don't throw - text extraction failure shouldn't block document
    console.log(`[TextProcessor] Continuing without text extraction`);
  }
}

export async function processSearchIndexJob(job: Job<SearchIndexJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, roomId, fileName, text, metadata } = job.data;

  console.log(`[TextProcessor] Indexing document ${documentId} for search`);

  const providers = getProviders();

  try {
    // Get document version for additional metadata
    const version = await db.documentVersion.findUnique({
      where: { id: versionId },
      select: { mimeType: true, createdAt: true },
    });

    // Get document for tags
    const document = await db.document.findFirst({
      where: { id: documentId, organizationId },
      select: { tags: true, customMetadata: true },
    });

    // Create or update search index record
    await db.searchIndex.upsert({
      where: {
        organizationId_versionId: {
          organizationId,
          versionId,
        },
      },
      create: {
        organizationId,
        documentId,
        versionId,
        documentTitle: fileName,
        extractedText: text,
        fileName,
        tags: document?.tags ?? [],
        customMetadata: document?.customMetadata ?? undefined,
        mimeType: version?.mimeType ?? 'application/octet-stream',
        uploadedAt: version?.createdAt ?? new Date(),
      },
      update: {
        documentTitle: fileName,
        extractedText: text,
        fileName,
        tags: document?.tags ?? [],
        customMetadata: document?.customMetadata ?? undefined,
      },
    });

    // Also index in external search provider (if configured)
    await providers.search.index(organizationId, documentId, versionId, {
      title: fileName,
      text,
      metadata: {
        roomId,
        ...metadata,
      },
    });

    console.log(`[TextProcessor] Document ${documentId} indexed successfully`);
  } catch (error) {
    console.error(`[TextProcessor] Search indexing failed for document ${documentId}:`, error);
    // Don't throw - indexing failure shouldn't block document
    console.log(`[TextProcessor] Continuing without search indexing`);
  }
}
