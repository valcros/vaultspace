/**
 * Text Extraction Job Processor
 *
 * Processes text extraction jobs for search indexing.
 * Supports PDF text extraction and OCR for images.
 */

import { Job } from 'bullmq';
import { PDFParse } from 'pdf-parse';

import { withOrgContext } from '@/lib/db';
import { isServable } from '@/lib/documents/scanGate';
import { getProviders } from '@/providers';

import type { SearchIndexJobPayload, TextExtractJobPayload } from '../types';

export async function processTextExtractJob(job: Job<TextExtractJobPayload>): Promise<void> {
  const { documentId, versionId, organizationId, contentType, fileName: _fileName } = job.data;

  console.log(`[TextProcessor] Extracting text for document ${documentId}, version ${versionId}`);

  const providers = getProviders();

  // Worker-side scan gate: never extract/index an INFECTED / still-scanning
  // original -- indexed text surfaces as search snippets. Queue payloads are not
  // authorization, so re-check the version's persisted scan status here, and read
  // the authoritative blob key from the same row so the bytes we extract are
  // provably the ones whose scan status we just validated.
  const versionScan = await withOrgContext(organizationId, (tx) =>
    tx.documentVersion.findFirst({
      where: { id: versionId, organizationId },
      select: {
        scanStatus: true,
        fileBlob: { select: { storageKey: true, storageBucket: true } },
      },
    })
  );
  if (!versionScan || !isServable(versionScan.scanStatus)) {
    console.warn(
      `[TextProcessor] Version ${versionId} not servable (scanStatus=${versionScan?.scanStatus ?? 'missing'}); skipping text extraction`
    );
    return;
  }
  if (!versionScan.fileBlob?.storageKey) {
    console.warn(`[TextProcessor] Version ${versionId} has no file blob; skipping text extraction`);
    return;
  }

  try {
    // Get the original bytes using the DB-authoritative blob key (bound to the
    // scanStatus validated above), not the queue payload's storageKey.
    const fileBuffer = await providers.storage.get(
      versionScan.fileBlob.storageBucket || 'documents',
      versionScan.fileBlob.storageKey
    );

    let extractedText = '';
    let detectedLanguage: string | null = null;

    // Check content type and extract accordingly
    if (contentType === 'text/plain') {
      extractedText = fileBuffer.toString('utf-8');
      detectedLanguage = 'en';
    } else if (contentType === 'application/pdf') {
      // Extract text from PDF using pdf-parse v2
      try {
        const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
        const pdfData = await parser.getText();
        extractedText = pdfData.text || '';
        detectedLanguage = 'en'; // PDF doesn't provide language info

        // If PDF has no extractable text, it might be image-based - try OCR
        if (!extractedText.trim() && (await providers.ocr.isAvailable())) {
          console.log(`[TextProcessor] PDF appears image-based, attempting OCR`);
          const ocrResult = await providers.ocr.extractText(fileBuffer, contentType);
          extractedText = ocrResult.text;
          detectedLanguage = ocrResult.language;
        }
      } catch (pdfError) {
        console.warn(`[TextProcessor] PDF extraction failed, trying OCR:`, pdfError);
        // Fallback to OCR if PDF parsing fails
        if (await providers.ocr.isAvailable()) {
          const ocrResult = await providers.ocr.extractText(fileBuffer, contentType);
          extractedText = ocrResult.text;
          detectedLanguage = ocrResult.language;
        }
      }
    } else if (contentType.startsWith('image/')) {
      // Use OCR for images
      if (await providers.ocr.isAvailable()) {
        const ocrResult = await providers.ocr.extractText(fileBuffer, contentType);
        extractedText = ocrResult.text;
        detectedLanguage = ocrResult.language;
        console.log(
          `[TextProcessor] OCR extracted ${extractedText.length} chars with ${ocrResult.confidence}% confidence`
        );
      } else {
        console.log(`[TextProcessor] OCR not available for image extraction`);
      }
    } else {
      // Other formats - no text extraction available
      console.log(`[TextProcessor] No text extraction for content type: ${contentType}`);
      extractedText = '';
    }

    const document = await withOrgContext(organizationId, async (tx) => {
      // Create or update extracted text record
      await tx.extractedText.upsert({
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

      // Get document for room info
      return tx.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
        select: {
          roomId: true,
          name: true,
        },
      });
    });

    console.log(`[TextProcessor] Text extracted: ${extractedText.length} characters`);

    if (document) {
      // Queue search indexing
      await providers.job.addJob('normal', 'search.index', {
        documentId,
        versionId,
        organizationId,
        roomId: document.roomId,
        fileName: document.name,
        text: extractedText,
        metadata: {
          pageCount: job.data.pageCount,
        },
      } satisfies SearchIndexJobPayload);
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
    const indexed = await withOrgContext(organizationId, async (tx) => {
      // Get document version for additional metadata + scan status.
      const version = await tx.documentVersion.findFirst({
        where: { id: versionId, organizationId },
        select: { mimeType: true, createdAt: true, scanStatus: true },
      });

      // Worker-side scan gate: never index (or keep) search text for a
      // non-servable version -- indexed text surfaces as search snippets. This
      // catches stale/redelivered/tampered jobs that textProcessor's gate did
      // not (queue payloads are not authorization).
      if (!version || !isServable(version.scanStatus)) {
        console.warn(
          `[TextProcessor] Version ${versionId} not servable (scanStatus=${version?.scanStatus ?? 'missing'}); skipping search index and purging any existing row`
        );
        // Best-effort: remove any previously-indexed row for this version so a
        // version that turned non-servable cannot linger in search results.
        await tx.searchIndex.deleteMany({ where: { organizationId, versionId } });
        return false;
      }

      // Get document for tags
      const document = await tx.document.findFirst({
        where: { id: documentId, organizationId },
        select: { tags: true, customMetadata: true },
      });

      // Create or update search index record
      await tx.searchIndex.upsert({
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
          roomId: roomId ?? null,
          documentTitle: fileName,
          extractedText: text,
          fileName,
          tags: document?.tags ?? [],
          customMetadata: document?.customMetadata ?? undefined,
          mimeType: version?.mimeType ?? 'application/octet-stream',
          uploadedAt: version?.createdAt ?? new Date(),
        },
        update: {
          roomId: roomId ?? null,
          documentTitle: fileName,
          extractedText: text,
          fileName,
          tags: document?.tags ?? [],
          customMetadata: document?.customMetadata ?? undefined,
        },
      });
      return true;
    });

    if (!indexed) {
      return;
    }

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
