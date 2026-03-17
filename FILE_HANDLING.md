# FILE_HANDLING.md - VaultSpace File Upload, Download, and Preview Pipeline

**Status:** MVP Specification (Features F006, F007, F008, F009, F101, F107, F132)
**Last Updated:** 2026-03-14
**Version:** 1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Upload Flow](#upload-flow)
3. [Supported File Types and MIME Types](#supported-file-types-and-mime-types)
4. [Preview Generation Pipeline](#preview-generation-pipeline)
5. [Document State Machine](#document-state-machine)
6. [Download Flow](#download-flow)
7. [Storage Layout](#storage-layout)
8. [Preview Dimensions and Quality](#preview-dimensions-and-quality)
9. [Error Handling and Fallbacks](#error-handling-and-fallbacks)
10. [TypeScript Interfaces](#typescript-interfaces)
11. [Implementation Checklist](#implementation-checklist)

---

## Overview

VaultSpace provides a secure, event-driven file upload, processing, and download pipeline designed for compliance-critical document management. All files are:

- **Uploaded via server-proxy** (client → Next.js API → StorageProvider)
- **Virus-scanned** before becoming viewable
- **Converted to PDF** for in-browser preview (multi-format support)
- **Full-text indexed** for search (including OCR extraction from scanned documents)
- **Signed URLs** for secure download with expiry and audit logging
- **Immutable versions** with hash-chain integrity verification

**Key Constraints:**

- Max file size: **500MB per file** (deferred to V1: resumable/chunked uploads)
- No streaming during upload (full file buffered; V1 will support streaming)
- All file operations emit audit events (immutable EventBus)
- Tenant isolation enforced at API and data-access layers

---

## Upload Flow

### 1. Request Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Client (Web Browser / API Client)                               │
│ → FormData with file(s), roomId, folderId (F006, F007)          │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/rooms/{roomId}/documents (upload)                     │
│ ├─ Authentication middleware: extract actor from session        │
│ ├─ Tenancy middleware: scope to actor.organizationId            │
│ └─ Authorization: PermissionEngine.check('document.upload')     │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Parse multipart form (formidable or busboy)                     │
│ ├─ Extract file(s), roomId, folderId, tags                      │
│ └─ Store in memory buffer (max 500MB per file)                  │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ File Validation                                                  │
│ ├─ Size check: <= 500MB                                         │
│ ├─ MIME type allowlist: check against SupportedFileType table   │
│ ├─ Filename sanitization: remove special chars, max 255 chars   │
│ └─ Return 400 Bad Request if validation fails                   │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ StorageProvider.putObject(storageKey, fileBuffer, metadata)     │
│ ├─ storageKey: /{orgId}/documents/{docId}/versions/{versionId}/ │
│ │              original/{sanitized_filename}                    │
│ ├─ metadata: mimeType, fileSize, sha256Hash, uploadedBy         │
│ └─ Retry on transient failure (max 3 retries)                   │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Transaction: Create document + version records                  │
│ ├─ INSERT Document (organizationId, roomId, folderId, name, ... )│
│ ├─ INSERT DocumentVersion (docId, versionNum=1, status=SCANNING) │
│ ├─ INSERT FileBlob (versionId, storagePath, sha256, size, ...)   │
│ ├─ INSERT PreviewAsset (versionId, status=PENDING)              │
│ └─ COMMIT or rollback entire transaction                        │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Emit EventBus event: 'document.uploaded'                        │
│ ├─ documentId, roomId, versionId, actorId, fileName, fileSize   │
│ ├─ requestId, sessionId, timestamp                              │
│ └─ Consumed by: audit trail, webhooks, notifications            │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Queue high-priority background jobs                             │
│ ├─ Job 'scan': ScanProvider.scan(fileKey)                       │
│ ├─ Job 'preview': PreviewProvider.convertToPreview(fileKey)     │
│ └─ Return 201 Created, document summary, preview status         │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Client receives response                                         │
│ {                                                               │
│   id: "doc_abc123",                                             │
│   name: "Term Sheet.docx",                                      │
│   status: "SCANNING",                                           │
│   previewStatus: "PENDING",                                     │
│   uploadedAt: "2026-03-14T10:30:00Z",                           │
│   fileSize: 245120                                              │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Multipart Form Data Handling

**Library:** `formidable` (recommended for Next.js 14+)

```typescript
// app/api/rooms/[roomId]/documents/route.ts
import formidable from 'formidable';

export async function POST(request: NextRequest, context: { params: { roomId: string } }) {
  const form = formidable({
    multiples: true,
    maxFileSize: 500 * 1024 * 1024, // 500MB
    uploadDir: '/tmp',
  });

  const [fields, files] = await form.parse(request);

  const fileArray = Array.isArray(files.file) ? files.file : [files.file];
  const roomId = context.params.roomId;
  const folderId = fields.folderId?.[0];

  // Process each file through DocumentService
  const uploadResults = await Promise.all(
    fileArray.map((file) =>
      documentService.upload({
        file,
        roomId,
        folderId,
        actor,
      })
    )
  );

  return Response.json(
    {
      success: true,
      documents: uploadResults,
    },
    { status: 201 }
  );
}
```

**Alternative:** `busboy` for Node.js streams (lighter weight, no file system temp)

```typescript
import busboy from 'busboy';

export async function POST(request: NextRequest) {
  const bb = busboy({ headers: request.headers });

  const uploads: Promise<Document>[] = [];

  bb.on('file', (fieldname, file, info) => {
    const chunks: Buffer[] = [];
    file.on('data', (data) => chunks.push(data));
    file.on('end', () => {
      uploads.push(
        documentService.upload({
          file: {
            filename: info.filename,
            mimetype: info.mimeType,
            data: Buffer.concat(chunks),
          },
          roomId,
          actor,
        })
      );
    });
  });

  return new Promise((resolve) => {
    bb.on('close', async () => {
      const results = await Promise.all(uploads);
      resolve(Response.json({ documents: results }, { status: 201 }));
    });
    request.body?.pipeTo(Readable.toWeb(bb) as any);
  });
}
```

### 3. File Validation

**Size Check:**

- Reject if file > 500MB (HTTP 413 Payload Too Large)
- Check BEFORE storing to disk

**MIME Type Allowlist:**

- Validate `file.mimetype` against table in [Section 3](#supported-file-types-and-mime-types)
- Fallback: detect via file magic bytes (libmagic/file-type npm package)
- Reject unknown types (HTTP 400 Unsupported Media Type)

**Filename Sanitization:**

```typescript
function sanitizeFilename(input: string): string {
  // Remove path traversal attempts
  const basename = path.basename(input);

  // Remove special characters (keep alphanumeric, dots, hyphens, underscores)
  const sanitized = basename
    .replace(/[^\w\s\-\.]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 255);

  return sanitized || 'document';
}

function validateFilename(filename: string): { valid: boolean; error?: string } {
  if (!filename || filename.length === 0) {
    return { valid: false, error: 'Filename is empty' };
  }
  if (filename.length > 255) {
    return { valid: false, error: 'Filename exceeds 255 characters' };
  }
  if (filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'Filename contains path separators' };
  }
  return { valid: true };
}
```

### 4. Storage Path Convention

**Standard layout:**

```
/{organizationId}/
  documents/
    {documentId}/
      versions/
        {versionId}/
          original/{sanitized_filename}
          preview/
            preview.pdf
            page-0001.png
            page-0002.png
            ...
          thumbnails/
            thumb-150.png
            preview-800.png
          extracted/
            text.txt
          metadata.json
```

**Examples:**

```
/org_abc123/documents/doc_xyz/versions/v1/original/Term_Sheet.docx
/org_abc123/documents/doc_xyz/versions/v1/preview/preview.pdf
/org_abc123/documents/doc_xyz/versions/v1/thumbnails/thumb-150.png
/org_abc123/documents/doc_xyz/versions/v1/extracted/text.txt
```

**Generation (in DocumentService):**

```typescript
function generateStoragePaths(
  organizationId: string,
  documentId: string,
  versionId: string,
  filename: string
): StoragePaths {
  const base = `/${organizationId}/documents/${documentId}/versions/${versionId}`;

  return {
    original: `${base}/original/${filename}`,
    previewPdf: `${base}/preview/preview.pdf`,
    previewPages: `${base}/preview/page-{0000}.png`,
    thumbnail150: `${base}/thumbnails/thumb-150.png`,
    preview800: `${base}/thumbnails/preview-800.png`,
    extractedText: `${base}/extracted/text.txt`,
    metadata: `${base}/metadata.json`,
  };
}
```

### 5. Upload Progress: SSE Endpoint (Optional MVP, V1 Priority)

**Note:** Chunked/resumable uploads deferred to V1. MVP uses simple single-request upload.

For future progress tracking:

```typescript
// app/api/rooms/[roomId]/documents/progress route
export async function GET(request: NextRequest, context: { params: { roomId: string } }) {
  const uploadId = request.nextUrl.searchParams.get('uploadId');

  const encoder = new TextEncoder();
  const customReadable = new ReadableStream({
    async start(controller) {
      // Poll upload progress from cache
      const interval = setInterval(async () => {
        const progress = await cacheProvider.get(`upload:${uploadId}`);

        if (progress) {
          const bytes = encoder.encode(`data: ${JSON.stringify(progress)}\n\n`);
          controller.enqueue(bytes);
        }

        if (progress?.status === 'complete') {
          clearInterval(interval);
          controller.close();
        }
      }, 500);
    },
  });

  return new Response(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

### 6. Abandoned Upload Cleanup (Scheduled Job)

**Purpose:** Delete orphaned blobs that were uploaded but document creation failed.

```typescript
// workers/cleanup-worker.ts
jobQueue.process('cleanup:abandoned-uploads', async () => {
  // Find documents in UPLOADING state for > 24 hours
  const orphaned = await db.documentVersion.findMany({
    where: {
      status: 'UPLOADING',
      createdAt: {
        lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h ago
      },
    },
    include: {
      document: true,
      fileBlob: true,
    },
  });

  for (const version of orphaned) {
    try {
      // Delete from storage
      await storageProvider.deleteObject(version.fileBlob.storagePath);

      // Mark version as FAILED
      await db.documentVersion.update({
        where: { id: version.id },
        data: { status: 'FAILED' },
      });

      // Emit event
      await eventBus.emit('upload.abandoned', {
        documentId: version.documentId,
        versionId: version.id,
        organizationId: version.document.organizationId,
      });
    } catch (error) {
      logger.error('Failed to cleanup abandoned upload', { versionId: version.id, error });
    }
  }
});

// Schedule via cron: daily at 2 AM
export const abandonedUploadCleanup = {
  pattern: '0 2 * * *', // 2 AM daily, local time
  name: 'cleanup:abandoned-uploads',
};
```

---

## Supported File Types and MIME Types

### Comprehensive File Type Matrix

| Extension    | MIME Type                                                                 | Category        | Preview Strategy          | Thumbnail Strategy     | Conversion Tool                | Output Format | Est. Processing Time | Tier |
| ------------ | ------------------------------------------------------------------------- | --------------- | ------------------------- | ---------------------- | ------------------------------ | ------------- | -------------------- | ---- |
| **PDF**      | application/pdf                                                           | PDF             | Native PDF (passthrough)  | ImageMagick extract    | Passthrough                    | PDF           | 5s                   | 1    |
| **DOCX**     | application/vnd.openxmlformats-officedocument.wordprocessingml.document   | Office          | Gotenberg convert         | Render to PNG          | Gotenberg + Tesseract          | PDF           | 30s                  | 1    |
| **XLSX**     | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         | Office          | Gotenberg convert         | Render to PNG          | Gotenberg + Tesseract          | PDF           | 45s                  | 1    |
| **PPTX**     | application/vnd.openxmlformats-officedocument.presentationml.presentation | Office          | Gotenberg convert         | Render first slide PNG | Gotenberg + Tesseract          | PDF           | 40s                  | 1    |
| **PPT**      | application/vnd.ms-powerpoint                                             | Office (Legacy) | Gotenberg convert         | Render first slide PNG | Gotenberg + Tesseract          | PDF           | 50s                  | 2    |
| **DOC**      | application/msword                                                        | Office (Legacy) | Gotenberg convert         | Render to PNG          | Gotenberg + Tesseract          | PDF           | 40s                  | 2    |
| **XLS**      | application/vnd.ms-excel                                                  | Office (Legacy) | Gotenberg convert         | Render to PNG          | Gotenberg + Tesseract          | PDF           | 50s                  | 2    |
| **PNG**      | image/png                                                                 | Image           | ImageMagick resize        | Native PNG             | ImageMagick embed in PDF       | PDF           | 10s                  | 1    |
| **JPG/JPEG** | image/jpeg                                                                | Image           | ImageMagick resize        | Native JPEG            | ImageMagick embed in PDF       | PDF           | 10s                  | 1    |
| **GIF**      | image/gif                                                                 | Image           | ImageMagick to PNG        | ImageMagick to PNG     | ImageMagick embed in PDF       | PDF           | 15s                  | 2    |
| **SVG**      | image/svg+xml                                                             | Image (Vector)  | Inkscape render           | Inkscape render        | Inkscape to PDF                | PDF           | 20s                  | 2    |
| **TIFF**     | image/tiff                                                                | Image (Scanned) | ImageMagick extract + OCR | ImageMagick extract    | ImageMagick to PDF + Tesseract | PDF + Text    | 60s                  | 1    |
| **TXT**      | text/plain                                                                | Text            | Embed in PDF              | Generic icon           | wkhtmltopdf                    | PDF           | 5s                   | 1    |
| **CSV**      | text/csv                                                                  | Data            | Format as table + PDF     | Generic icon           | wkhtmltopdf                    | PDF           | 8s                   | 2    |
| **RTF**      | application/rtf                                                           | Text            | LibreOffice convert       | Generic icon           | LibreOffice                    | PDF           | 15s                  | 2    |

### MIME Type Allowlist Validation

```typescript
const SUPPORTED_MIME_TYPES: SupportedFileType[] = [
  // PDFs
  { ext: 'pdf', mimeType: 'application/pdf', category: 'PDF', previewable: true },

  // Office Documents (Modern OOXML)
  {
    ext: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'Office',
    previewable: true,
  },
  {
    ext: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'Office',
    previewable: true,
  },
  {
    ext: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'Office',
    previewable: true,
  },

  // Images
  { ext: 'png', mimeType: 'image/png', category: 'Image', previewable: true },
  { ext: 'jpg', mimeType: 'image/jpeg', category: 'Image', previewable: true },
  { ext: 'jpeg', mimeType: 'image/jpeg', category: 'Image', previewable: true },
  { ext: 'gif', mimeType: 'image/gif', category: 'Image', previewable: true },
  { ext: 'svg', mimeType: 'image/svg+xml', category: 'Image', previewable: true },
  { ext: 'tiff', mimeType: 'image/tiff', category: 'Image', previewable: true },
  { ext: 'tif', mimeType: 'image/tiff', category: 'Image', previewable: true },

  // Plain Text
  { ext: 'txt', mimeType: 'text/plain', category: 'Text', previewable: true },
  { ext: 'csv', mimeType: 'text/csv', category: 'Data', previewable: true },
];

function validateMimeType(
  filename: string,
  mimeType: string
): { valid: boolean; type?: SupportedFileType; error?: string } {
  // Try match by extension first
  const ext = filename.split('.').pop()?.toLowerCase();
  const byExt = SUPPORTED_MIME_TYPES.find((t) => t.ext === ext);

  if (!byExt) {
    return { valid: false, error: `File type .${ext} not supported` };
  }

  // Verify MIME type matches (loose check for typos from clients)
  if (mimeType && !mimeType.includes(byExt.category.toLowerCase())) {
    logger.warn('MIME type mismatch', { filename, mimeType, expected: byExt.mimeType });
    // Don't reject; client may have sent wrong MIME type. Trust extension + magic bytes.
  }

  return { valid: true, type: byExt };
}

// Alternative: magic-bytes detection (file-type npm)
import FileType from 'file-type';

async function detectMimeType(buffer: Buffer): Promise<string | null> {
  const type = await FileType.fromBuffer(buffer);
  return type?.mime ?? null;
}
```

### File Categories and Conversion Strategy

**PDF (Native):** No conversion. Passthrough to preview storage. Extract text for OCR if scanned.

**Office Documents (DOCX/XLSX/PPTX):** Convert via Gotenberg to PDF. If multi-page, extract all pages for thumbnails.

**Images (PNG/JPG/TIFF):** Embed single-page PDF using ImageMagick. TIFF files scanned → apply OCR during extraction.

**Text Files (TXT/CSV):** Format as styled PDF (HTML → PDF via wkhtmltopdf or Gotenberg).

**Video (MP4/MOV):** V1+. Placeholder thumbnail, no preview generation.

**CAD (DWG/DXF):** V2+. Requires specialized converter.

---

## Preview Generation Pipeline

### Overview: 5-Stage Processing

All document previews are generated asynchronously via background jobs. Each stage is retryable with exponential backoff.

```
Original File
    ↓
[Stage 1: Scan]       ScanProvider.scan()
    ↓
[Stage 2: Convert]    PreviewProvider.convertToPreview()
    ↓
[Stage 3: Extract]    PreviewProvider.extractText() [includes OCR for scanned]
    ↓
[Stage 4: Thumbnail]  PreviewProvider.generateThumbnail()
    ↓
[Stage 5: Index]      SearchIndex.upsert()
    ↓
Document → ACTIVE
```

### Stage 1: Virus Scan

**Trigger:** DocumentVersion created with status SCANNING
**Job Priority:** HIGH
**Provider:** ScanProvider (default: ClamAV)

```typescript
// workers/scan-worker.ts
jobQueue.process(
  'scan',
  async (job: Job<ScanJobPayload>) => {
    const { documentId, versionId, fileKey } = job.data;

    try {
      // Check if already scanned (idempotency)
      const version = await db.documentVersion.findUnique({
        where: { id: versionId },
        include: { document: true },
      });

      if (version.status !== 'SCANNING') {
        logger.info('Version already scanned, skipping', { versionId });
        return;
      }

      // Scan via ClamAV or configured ScanProvider
      const scanResult = await scanProvider.scan(fileKey);

      if (scanResult.status === 'infected') {
        // Quarantine: mark as failed, notify admin
        await db.documentVersion.update({
          where: { id: versionId },
          data: { status: 'QUARANTINED', scanMetadata: scanResult.threats },
        });

        await eventBus.emit('document.quarantined', {
          documentId,
          versionId,
          organizationId: version.document.organizationId,
          threats: scanResult.threats,
        });

        // Notify admin
        await notificationService.sendAdminAlert({
          type: 'VIRUS_DETECTED',
          documentId,
          fileName: version.document.name,
          threats: scanResult.threats,
        });

        return;
      }

      if (scanResult.status === 'error') {
        throw new Error(`Scan failed: ${scanResult.error}`);
      }

      // Clean: proceed to conversion
      await db.documentVersion.update({
        where: { id: versionId },
        data: { status: 'CONVERTING' },
      });

      await eventBus.emit('document.scan_complete', {
        documentId,
        versionId,
        organizationId: version.document.organizationId,
        result: 'clean',
      });

      // Enqueue next stage
      await jobQueue.enqueue(
        'preview:convert',
        {
          documentId,
          versionId,
          fileKey,
        },
        { priority: 'high' }
      );
    } catch (error) {
      // Retry on transient error
      throw error; // BullMQ will retry
    }
  },
  {
    timeout: 60000, // 60s timeout
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  }
);
```

**ScanProvider Interface:**

```typescript
interface ScanResult {
  scanId: string;
  status: 'clean' | 'infected' | 'error';
  threats?: Array<{
    name: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  error?: string;
  scannedAt: Date;
}

interface ScanProvider {
  scan(fileKey: string): Promise<ScanResult>;
  getScanStatus(scanId: string): Promise<ScanResult>;
}
```

**ClamAV Implementation:**

```typescript
// lib/providers/ClamAVScanProvider.ts
class ClamAVScanProvider implements ScanProvider {
  private client: NodeClam;

  constructor(clamdUrl: string) {
    this.client = new NodeClam().init({
      clamdscan: {
        host: new URL(clamdUrl).hostname,
        port: new URL(clamdUrl).port,
      },
    });
  }

  async scan(fileKey: string): Promise<ScanResult> {
    try {
      // Download file from storage to temp location
      const fileBuffer = await storageProvider.getObject(fileKey);
      const tempPath = `/tmp/${crypto.randomUUID()}`;
      fs.writeFileSync(tempPath, fileBuffer);

      try {
        // Scan
        const { isInfected, viruses } = await this.client.scanFile(tempPath);

        if (isInfected) {
          return {
            scanId: crypto.randomUUID(),
            status: 'infected',
            threats: viruses.map((v) => ({
              name: v,
              type: 'virus',
              severity: 'high',
            })),
            scannedAt: new Date(),
          };
        }

        return {
          scanId: crypto.randomUUID(),
          status: 'clean',
          scannedAt: new Date(),
        };
      } finally {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      return {
        scanId: crypto.randomUUID(),
        status: 'error',
        error: error.message,
        scannedAt: new Date(),
      };
    }
  }

  async getScanStatus(scanId: string): Promise<ScanResult> {
    // ClamAV doesn't support async scan requests in MVP; implement via queue polling
    throw new Error('Not implemented for MVP');
  }
}
```

---

### Stage 2: Convert to PDF

**Trigger:** After successful scan (status = CONVERTING)
**Job Priority:** HIGH
**Provider:** PreviewProvider (default: GotenbergPreviewProvider)

```typescript
// workers/preview-convert-worker.ts
jobQueue.process(
  'preview:convert',
  async (job: Job<PreviewJobPayload>) => {
    const { documentId, versionId, fileKey } = job.data;

    try {
      const version = await db.documentVersion.findUnique({
        where: { id: versionId },
        include: { document: true, previewAsset: true },
      });

      if (version.status !== 'CONVERTING') {
        logger.info('Version not in CONVERTING state, skipping', { versionId });
        return;
      }

      // Determine MIME type from file extension
      const ext = version.document.name.split('.').pop()?.toLowerCase();
      const fileType = SUPPORTED_MIME_TYPES.find((t) => t.ext === ext);

      if (!fileType) {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      // Convert to PDF
      const previewResult = await previewProvider.convertToPreview(
        fileKey,
        fileType.mimeType,
        { pageCount: 500, quality: 'high' } // Max 500 pages
      );

      // Store preview PDF
      const previewPdfKey = `${version.document.organizationId}/documents/${documentId}/versions/${versionId}/preview/preview.pdf`;
      const previewBuffer = await storageProvider.getObject(previewResult.pdfKey);
      await storageProvider.putObject(previewPdfKey, previewBuffer, {
        mimeType: 'application/pdf',
        metadata: { pageCount: previewResult.pageCount },
      });

      // Update PreviewAsset
      await db.previewAsset.update({
        where: { versionId },
        data: {
          status: 'EXTRACTING',
          pdfStoragePath: previewPdfKey,
          pageCount: previewResult.pageCount,
          conversionMetadata: {
            tool: 'gotenberg',
            convertedAt: new Date().toISOString(),
          },
        },
      });

      await eventBus.emit('document.converted', {
        documentId,
        versionId,
        organizationId: version.document.organizationId,
        pageCount: previewResult.pageCount,
      });

      // Enqueue extraction
      await jobQueue.enqueue(
        'preview:extract',
        {
          documentId,
          versionId,
          fileKey,
          previewPdfKey,
        },
        { priority: 'high' }
      );
    } catch (error) {
      logger.error('Conversion failed', { versionId, error });
      throw error; // Retry
    }
  },
  {
    timeout: 120000, // 120s timeout
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  }
);
```

**PreviewProvider Interface:**

```typescript
interface PreviewResult {
  pdfKey: string;
  pageCount: number;
  size: number;
}

interface PreviewOptions {
  pageCount?: number; // Max pages to convert (truncate if needed)
  quality?: 'low' | 'medium' | 'high';
}

interface PreviewProvider {
  convertToPreview(
    sourceKey: string,
    sourceMimeType: string,
    options?: PreviewOptions
  ): Promise<PreviewResult>;

  generateThumbnail(
    pdfKey: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<Buffer>;

  extractText(sourceKey: string, sourceMimeType: string): Promise<string>;

  applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer>;

  getSupportedFormats(): Promise<string[]>;
}

interface WatermarkOptions {
  placement?: 'diagonal' | 'corner' | 'margin';
  fontSize?: number;
  opacity?: number;
  color?: string;
}
```

**GotenbergPreviewProvider Implementation:**

```typescript
// lib/providers/GotenbergPreviewProvider.ts
class GotenbergPreviewProvider implements PreviewProvider {
  private gotenbergUrl: string;
  private ocrEngine: OCREngine;

  constructor(gotenbergUrl: string, ocrEngine: OCREngine) {
    this.gotenbergUrl = gotenbergUrl;
    this.ocrEngine = ocrEngine;
  }

  async convertToPreview(
    sourceKey: string,
    sourceMimeType: string,
    options?: PreviewOptions
  ): Promise<PreviewResult> {
    const sourceBuffer = await storageProvider.getObject(sourceKey);
    const tempFile = path.join('/tmp', `${crypto.randomUUID()}.tmp`);

    try {
      fs.writeFileSync(tempFile, sourceBuffer);

      // Call Gotenberg API
      const form = new FormData();
      form.append('files', fs.createReadStream(tempFile));
      if (options?.pageCount) {
        form.append('pageRanges', `1-${options.pageCount}`);
      }

      const response = await fetch(`${this.gotenbergUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
        timeout: 120000,
      });

      if (!response.ok) {
        throw new Error(`Gotenberg returned ${response.status}`);
      }

      const pdfBuffer = await response.buffer();
      const pdfKey = `tmp/${crypto.randomUUID()}.pdf`;
      await storageProvider.putObject(pdfKey, pdfBuffer, {
        mimeType: 'application/pdf',
      });

      // Get page count via pdftotext or similar
      const pageCount = await this.getPageCount(pdfBuffer);

      return {
        pdfKey,
        pageCount,
        size: pdfBuffer.length,
      };
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  }

  private async getPageCount(pdfBuffer: Buffer): Promise<number> {
    // Use pdf-parse npm package
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer);
    return data.numpages;
  }

  async generateThumbnail(
    pdfKey: string,
    pageNum: number,
    width: number,
    height: number
  ): Promise<Buffer> {
    // Use GraphicsMagick (gm npm) to convert PDF page to PNG
    const pdfBuffer = await storageProvider.getObject(pdfKey);

    return new Promise((resolve, reject) => {
      gm(pdfBuffer, 'pdf')
        .density(150, 150)
        .page(`${pageNum}`)
        .resize(width, height, '>')
        .toBuffer('png', (err, buffer) => {
          if (err) reject(err);
          else resolve(buffer);
        });
    });
  }

  async extractText(sourceKey: string, sourceMimeType: string): Promise<string> {
    // Download source
    const sourceBuffer = await storageProvider.getObject(sourceKey);

    // If source is already PDF, extract text directly
    if (sourceMimeType === 'application/pdf') {
      return this.extractTextFromPdf(sourceBuffer);
    }

    // Convert to PDF first
    const previewResult = await this.convertToPreview(sourceKey, sourceMimeType);
    const pdfBuffer = await storageProvider.getObject(previewResult.pdfKey);

    // Extract text (with OCR if scanned)
    const text = await this.extractTextFromPdf(pdfBuffer);

    // Clean up temp PDF
    await storageProvider.deleteObject(previewResult.pdfKey);

    return text;
  }

  private async extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    // Use pdftotext npm package
    const pdfToText = require('pdf-to-text');

    return new Promise((resolve, reject) => {
      pdfToText.pdfToText(pdfBuffer, async (err, data) => {
        if (err) {
          logger.warn('pdftotext failed, attempting OCR', { error: err.message });
          // Fallback to OCR
          try {
            const ocrText = await this.ocrEngine.performOCR(pdfBuffer, 'application/pdf');
            resolve(ocrText);
          } catch (ocrErr) {
            reject(ocrErr);
          }
        } else {
          resolve(data);
        }
      });
    });
  }

  async applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer> {
    const pdfBuffer = await storageProvider.getObject(pdfKey);

    // Use PDFKit or pdflib to add watermark
    const PDFDocument = require('pdfkit');
    const pdfDoc = new PDFDocument();

    // This is simplified; in production use a more robust PDF library
    const output: Buffer[] = [];
    pdfDoc.on('data', (data) => output.push(data));

    pdfDoc.fontSize(40).text(watermarkText, 100, 100, { opacity: 0.3 });
    pdfDoc.end();

    return Buffer.concat(output);
  }

  async getSupportedFormats(): Promise<string[]> {
    return [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'image/tiff',
    ];
  }
}
```

---

### Stage 3: Text Extraction (includes OCR)

**Trigger:** After successful conversion (status = EXTRACTING)
**Job Priority:** HIGH
**Provider:** PreviewProvider.extractText() + OCREngine

```typescript
// workers/preview-extract-worker.ts
jobQueue.process(
  'preview:extract',
  async (job: Job<ExtractJobPayload>) => {
    const { documentId, versionId, fileKey, previewPdfKey } = job.data;

    try {
      const version = await db.documentVersion.findUnique({
        where: { id: versionId },
        include: { document: true, previewAsset: true },
      });

      if (version.previewAsset.status !== 'EXTRACTING') {
        logger.info('Preview not in EXTRACTING state', { versionId });
        return;
      }

      // Extract text from original file (will auto-convert + OCR if needed)
      const ext = version.document.name.split('.').pop()?.toLowerCase();
      const fileType = SUPPORTED_MIME_TYPES.find((t) => t.ext === ext);

      let extractedText: string;

      try {
        extractedText = await previewProvider.extractText(fileKey, fileType.mimeType);
      } catch (error) {
        logger.warn('Text extraction failed', { versionId, error });
        extractedText = ''; // Proceed without text; document still viewable
      }

      // Store extracted text
      const textKey = `${version.document.organizationId}/documents/${documentId}/versions/${versionId}/extracted/text.txt`;
      await storageProvider.putObject(textKey, Buffer.from(extractedText), {
        mimeType: 'text/plain',
      });

      // Update PreviewAsset
      await db.previewAsset.update({
        where: { versionId },
        data: {
          status: 'THUMBNAIL',
          extractedTextStoragePath: textKey,
          extractedTextLength: extractedText.length,
          extractedAt: new Date(),
        },
      });

      await eventBus.emit('document.text_extracted', {
        documentId,
        versionId,
        organizationId: version.document.organizationId,
        textLength: extractedText.length,
      });

      // Enqueue thumbnail generation
      await jobQueue.enqueue(
        'preview:thumbnail',
        {
          documentId,
          versionId,
          previewPdfKey,
        },
        { priority: 'high' }
      );
    } catch (error) {
      logger.error('Text extraction failed', { versionId, error });
      throw error; // Retry
    }
  },
  {
    timeout: 60000, // 60s timeout
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  }
);
```

**OCREngine Interface:**

```typescript
interface OCROptions {
  language?: string; // ISO language code, default 'en'
  quality?: 'fast' | 'normal' | 'high';
}

interface OCREngine {
  performOCR(sourceKey: string, sourceFormat: string, options?: OCROptions): Promise<string>;

  requiresOCR(sourceKey: string, sourceFormat: string): Promise<boolean>;
}
```

**TesseractOCREngine Implementation (MVP):**

```typescript
// lib/providers/TesseractOCREngine.ts
class TesseractOCREngine implements OCREngine {
  private worker: Tesseract.Worker;

  async initialize() {
    this.worker = await Tesseract.createWorker('eng'); // English default
  }

  async performOCR(sourceKey: string, sourceFormat: string, options?: OCROptions): Promise<string> {
    const buffer = await storageProvider.getObject(sourceKey);

    try {
      const result = await this.worker.recognize(buffer);
      return result.data.text;
    } finally {
      // Keep worker alive for pooling; terminate in cleanup
    }
  }

  async requiresOCR(sourceKey: string, sourceFormat: string): Promise<boolean> {
    // PDF is scanned if text extraction yields < 50 characters
    // This is a heuristic; alternatively use image detection
    if (sourceFormat !== 'application/pdf') {
      return false;
    }

    const buffer = await storageProvider.getObject(sourceKey);
    const pdfToText = require('pdf-to-text');

    return new Promise((resolve) => {
      pdfToText.pdfToText(buffer, (err, data) => {
        const textLength = data?.length || 0;
        resolve(textLength < 50);
      });
    });
  }
}
```

---

### Stage 4: Thumbnail Generation

**Trigger:** After successful extraction (status = THUMBNAIL)
**Job Priority:** HIGH
**Provider:** PreviewProvider.generateThumbnail()

```typescript
// workers/preview-thumbnail-worker.ts
jobQueue.process(
  'preview:thumbnail',
  async (job: Job<ThumbnailJobPayload>) => {
    const { documentId, versionId, previewPdfKey } = job.data;

    try {
      const version = await db.documentVersion.findUnique({
        where: { id: versionId },
        include: { previewAsset: true, document: true },
      });

      if (version.previewAsset.status !== 'THUMBNAIL') {
        return;
      }

      // Generate two thumbnails: 150x150 and 800px wide
      const thumb150 = await previewProvider.generateThumbnail(previewPdfKey, 1, 150, 150);
      const preview800 = await previewProvider.generateThumbnail(previewPdfKey, 1, 800, 0); // 0 = auto height

      // Store thumbnails
      const thumb150Key = `${version.document.organizationId}/documents/${documentId}/versions/${versionId}/thumbnails/thumb-150.png`;
      const preview800Key = `${version.document.organizationId}/documents/${documentId}/versions/${versionId}/thumbnails/preview-800.png`;

      await Promise.all([
        storageProvider.putObject(thumb150Key, thumb150, { mimeType: 'image/png' }),
        storageProvider.putObject(preview800Key, preview800, { mimeType: 'image/png' }),
      ]);

      // Update PreviewAsset
      await db.previewAsset.update({
        where: { versionId },
        data: {
          status: 'INDEXING',
          thumbnail150StoragePath: thumb150Key,
          preview800StoragePath: preview800Key,
          thumbnailGeneratedAt: new Date(),
        },
      });

      await eventBus.emit('document.thumbnail_generated', {
        documentId,
        versionId,
        organizationId: version.document.organizationId,
      });

      // Enqueue search index update
      await jobQueue.enqueue(
        'preview:index',
        {
          documentId,
          versionId,
        },
        { priority: 'high' }
      );
    } catch (error) {
      logger.error('Thumbnail generation failed', { versionId, error });
      throw error; // Retry
    }
  },
  {
    timeout: 30000, // 30s timeout
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  }
);
```

---

### Stage 5: Search Index Update

**Trigger:** After successful thumbnail generation (status = INDEXING)
**Job Priority:** HIGH
**Provider:** SearchIndex model (PostgreSQL FTS MVP, Meilisearch V1)

```typescript
// workers/preview-index-worker.ts
jobQueue.process(
  'preview:index',
  async (job: Job<IndexJobPayload>) => {
    const { documentId, versionId } = job.data;

    try {
      const version = await db.documentVersion.findUnique({
        where: { id: versionId },
        include: { previewAsset: true, document: true },
      });

      if (version.previewAsset.status !== 'INDEXING') {
        return;
      }

      // Retrieve extracted text
      let extractedText = '';
      if (version.previewAsset.extractedTextStoragePath) {
        const textBuffer = await storageProvider.getObject(
          version.previewAsset.extractedTextStoragePath
        );
        extractedText = textBuffer.toString('utf8');
      }

      // Upsert SearchIndex record
      await db.searchIndex.upsert({
        where: {
          documentId_versionId: { documentId, versionId },
        },
        create: {
          organizationId: version.document.organizationId,
          documentId,
          versionId,
          documentName: version.document.name,
          extractedText: extractedText,
          pageCount: version.previewAsset.pageCount,
          fileSize: version.document.fileSize,
          mimeType: version.document.mimeType,
          indexedAt: new Date(),
        },
        update: {
          extractedText,
          pageCount: version.previewAsset.pageCount,
          indexedAt: new Date(),
        },
      });

      // Mark PreviewAsset as ACTIVE
      await db.previewAsset.update({
        where: { versionId },
        data: { status: 'ACTIVE' },
      });

      // Mark DocumentVersion as ACTIVE
      await db.documentVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE' },
      });

      await eventBus.emit('document.indexed', {
        documentId,
        versionId,
        organizationId: version.document.organizationId,
        extractedTextLength: extractedText.length,
      });

      logger.info('Document preview pipeline complete', { documentId, versionId });
    } catch (error) {
      logger.error('Search index update failed', { versionId, error });
      throw error; // Retry
    }
  },
  {
    timeout: 10000, // 10s timeout
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
  }
);
```

**SearchIndex Schema:**

```prisma
model SearchIndex {
  id                  String @id @default(cuid())
  organizationId      String
  documentId          String
  versionId           String
  documentName        String
  extractedText       String @db.Text
  pageCount           Int?
  fileSize            Int
  mimeType            String
  indexedAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  document            Document @relation(fields: [documentId], references: [id])

  @@unique([documentId, versionId])
  @@index([organizationId, documentName])
  @@fulltext([documentName, extractedText]) // PostgreSQL FTS
}
```

---

## Document State Machine

> **Canonical contract (CANONICAL_CONTRACTS.md Section 10):** Processing state lives on `DocumentVersion` via `scanStatus` and `previewStatus` fields, NOT on `Document.status`. The `Document` model only tracks lifecycle: ACTIVE, ARCHIVED, DELETED. The states described below (UPLOADING, SCANNING, CONVERTING, EXTRACTING, THUMBNAIL, INDEXING, QUARANTINED, FAILED) map to `DocumentVersion.previewStatus` and `DocumentVersion.scanStatus` as detailed in the implementation notes.

### State Transitions

```
UPLOADING
    ↓
SCANNING
    ├─→ QUARANTINED (if virus detected)
    │
    └─→ CONVERTING
        ├─→ EXTRACTING
        │   ├─→ THUMBNAIL
        │   │   └─→ INDEXING
        │   │       └─→ ACTIVE ✓
        │   │
        │   └─→ FAILED (if extraction timeout/error)
        │
        └─→ FAILED (if conversion timeout/error)

FAILED
    └─→ (manual retry via admin UI)

QUARANTINED
    └─→ (manual review/delete via admin UI)

ACTIVE
    └─→ (document viewable by authorized users)
```

### State Definitions

| State           | Visibility       | Accessible To       | Actions Available                   | Notes                                                                                                                       |
| --------------- | ---------------- | ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **UPLOADING**   | Admin only       | Document creator    | Cancel upload                       | File being uploaded; not yet in storage. Orphaned uploads cleaned after 24h.                                                |
| **SCANNING**    | Admin only       | Document creator    | Cancel                              | File in storage, undergoing virus scan. User can view status.                                                               |
| **QUARANTINED** | Admin only       | Organization admins | Delete, manual review, whitelist    | Virus detected; file blocked from all users. Admin notified. Manual override option for false positives.                    |
| **CONVERTING**  | Admin only       | Document creator    | Cancel                              | Converting to PDF; no preview yet. User can view status.                                                                    |
| **EXTRACTING**  | Admin only       | Document creator    | Cancel                              | Extracting text & OCR; document still not viewable.                                                                         |
| **THUMBNAIL**   | Admin only       | Document creator    | Cancel                              | Generating thumbnails; document still not viewable.                                                                         |
| **INDEXING**    | Admin only       | Document creator    | Cancel                              | Updating search index; document almost ready.                                                                               |
| **ACTIVE**      | Authorized users | Per ACL             | Download, preview, tag, move, share | Document fully processed and viewable. All preview assets available. Searchable.                                            |
| **FAILED**      | Admin only       | Organization admins | Retry, delete                       | Preview generation failed (timeout, conversion error, etc.). Max 3 auto-retries attempted. Manual retry button in admin UI. |

### State Transition Rules

**Preconditions:**

- Document must be in correct state for stage to run
- Job uses idempotency check to skip if state already transitioned
- Max 3 auto-retries per stage before marking FAILED
- Manual retry can restart from any FAILED stage

**Error Handling:**

- If stage times out → transition to FAILED
- If stage encounters unrecoverable error → transition to FAILED
- If transient error (network, temp resource unavailable) → retry with backoff
- If max retries exceeded → transition to FAILED

**State Visibility:**

```typescript
// In UI and API responses
function getDocumentVisibility(
  document: Document,
  actor: Actor,
  permission: PermissionLevel
): DocumentVisibility {
  // Documents in UPLOADING/SCANNING/CONVERTING/EXTRACTING hidden from viewers
  if (['UPLOADING', 'SCANNING', 'CONVERTING', 'EXTRACTING'].includes(document.status)) {
    // Admin/creator can see status and retry option
    if (permission === 'ADMIN' || document.createdBy === actor.id) {
      return {
        visible: true,
        showStatus: true,
        showRetry: false,
        previewAvailable: false,
      };
    }
    // Other users can't see this document yet
    return { visible: false };
  }

  if (document.status === 'ACTIVE') {
    return {
      visible: permission !== 'NONE',
      showStatus: false,
      previewAvailable: true,
    };
  }

  if (document.status === 'FAILED') {
    return {
      visible: permission === 'ADMIN',
      showStatus: true,
      showRetry: true,
      previewAvailable: false,
    };
  }

  if (document.status === 'QUARANTINED') {
    return {
      visible: permission === 'ADMIN',
      showStatus: true,
      showRetry: false,
      virusAlert: true,
    };
  }

  return { visible: false };
}
```

---

## Download Flow

### 1. Request Flow

```
GET /api/rooms/{roomId}/documents/{docId}/download
    ├─ Authentication: extract actor
    ├─ Authorization: PermissionEngine.check('document.download', docId)
    ├─ Validate document exists and is ACTIVE
    ├─ Emit audit event: 'document.downloaded'
    ├─ Generate signed URL (1-hour expiry)
    └─ Return redirect to StorageProvider signed URL
        └─ StorageProvider streams file directly to client
            └─ No buffering in app memory
```

### 2. Signed URL Generation

```typescript
// lib/services/DocumentService.ts
async getDownloadUrl(
  documentId: string,
  actor: Actor,
  options?: { expirySeconds?: number }
): Promise<string> {
  // Authorize
  await permissionEngine.check(actor, 'document.download', documentId);

  const document = await db.document.findFirst({
    where: { id: documentId, organizationId: actor.organizationId },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });

  if (!document) {
    throw new NotFoundError('Document not found');
  }

  if (document.versions[0].status !== 'ACTIVE') {
    throw new BadRequestError('Document preview is not ready');
  }

  const fileBlob = await db.fileBlob.findUnique({
    where: { versionId: document.versions[0].id },
  });

  const expirySeconds = options?.expirySeconds || 3600; // 1 hour default

  // Generate signed URL (storage-provider specific)
  const signedUrl = await storageProvider.getSignedUrl(
    fileBlob.storagePath,
    'GET',
    { expirySeconds }
  );

  // Emit audit event
  await eventBus.emit('document.downloaded', {
    documentId,
    versionId: document.versions[0].id,
    actorId: actor.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    organizationId: actor.organizationId,
    timestamp: new Date(),
  });

  return signedUrl;
}

// app/api/rooms/[roomId]/documents/[docId]/download/route.ts
export async function GET(
  request: NextRequest,
  context: { params: { roomId: string; docId: string } }
) {
  try {
    const actor = await authenticateRequest(request);
    if (!actor) return response.unauthorized();

    const documentService = createDocumentService();
    const signedUrl = await documentService.getDownloadUrl(context.params.docId, actor);

    // Redirect to signed URL
    return response.redirect(signedUrl);
  } catch (error) {
    if (error instanceof UnauthorizedError) return response.forbidden();
    if (error instanceof NotFoundError) return response.notFound();
    throw error;
  }
}
```

### 3. Preview URL (with Client-Side Refresh)

```typescript
// Signed URLs for preview PDFs expire after 5 minutes
// Client-side JS periodically refreshes the URL

async function getPreviewUrl(documentId: string): Promise<string> {
  const response = await fetch(`/api/documents/${documentId}/preview-url`);
  return response.json().then(r => r.url);
}

// In React component:
function DocumentViewer({ documentId }: { documentId: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const refreshUrl = async () => {
      const url = await getPreviewUrl(documentId);
      setPreviewUrl(url);
    };

    refreshUrl();

    // Refresh every 4 minutes (before 5-minute expiry)
    const interval = setInterval(refreshUrl, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, [documentId]);

  if (!previewUrl) return <div>Loading preview...</div>;

  return (
    <iframe
      src={previewUrl}
      style={{ width: '100%', height: '100vh' }}
      title="Document Preview"
    />
  );
}
```

### 4. Content-Disposition Headers

```typescript
// Determine inline vs. attachment based on action

async function getDownloadUrl(docId: string, preview: boolean = false): Promise<string> {
  const document = await db.document.findUnique({ where: { id: docId } });

  const signedUrl = await storageProvider.getSignedUrl(document.fileBlob.storagePath, 'GET', {
    expirySeconds: preview ? 300 : 3600, // 5min for preview, 1h for download
    contentDisposition: preview ? 'inline' : 'attachment',
    responseHeaders: {
      'Content-Disposition': preview
        ? `inline; filename="${document.name}"`
        : `attachment; filename="${document.name}"`,
    },
  });

  return signedUrl;
}
```

### 5. Streaming (No Full Buffering)

StorageProvider implementations MUST support streaming:

```typescript
// lib/providers/S3StorageProvider.ts
async getObjectStream(key: string): Promise<ReadableStream> {
  const command = new GetObjectCommand({
    Bucket: this.bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  // Return readable stream; app never buffers full file
  return Readable.toWeb(response.Body as NodeJS.ReadableStream) as ReadableStream;
}

// app/api/rooms/[roomId]/documents/[docId]/download/route.ts (alternative: direct stream)
export async function GET(request: NextRequest, context: { params }) {
  const { docId } = context.params;

  const document = await db.document.findUnique({ where: { id: docId } });
  const stream = await storageProvider.getObjectStream(document.fileBlob.storagePath);

  return new Response(stream, {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename="${document.name}"`,
      'Content-Length': document.fileSize.toString(),
    },
  });
}
```

---

## Storage Layout

### Directory Structure (Comprehensive)

```
s3://vaultspace-storage/ (or local /data/storage/)
│
├─ {organizationId}/
│  │
│  ├─ documents/
│  │  │
│  │  ├─ {documentId}/
│  │  │  │
│  │  │  └─ versions/
│  │  │     │
│  │  │     └─ {versionId}/
│  │  │        │
│  │  │        ├─ original/
│  │  │        │  └─ {sanitized_filename}
│  │  │        │
│  │  │        ├─ preview/
│  │  │        │  ├─ preview.pdf
│  │  │        │  ├─ page-0001.png (optional; multi-page)
│  │  │        │  ├─ page-0002.png
│  │  │        │  └─ ...
│  │  │        │
│  │  │        ├─ thumbnails/
│  │  │        │  ├─ thumb-150.png (150x150, JPEG q80)
│  │  │        │  └─ preview-800.png (800px wide, PNG or JPEG q85)
│  │  │        │
│  │  │        ├─ extracted/
│  │  │        │  └─ text.txt (full-text search index)
│  │  │        │
│  │  │        └─ metadata.json
│  │  │           {
│  │  │             "versionId": "v1",
│  │  │             "uploadedBy": "user_xyz",
│  │  │             "uploadedAt": "2026-03-14T10:30:00Z",
│  │  │             "mimeType": "application/vnd.ms-word",
│  │  │             "fileSize": 245120,
│  │  │             "sha256": "abc123...",
│  │  │             "pageCount": 12,
│  │  │             "conversionTool": "gotenberg",
│  │  │             "conversionTime": "2.5s",
│  │  │             "extractionStatus": "success",
│  │  │             "ocrApplied": true
│  │  │           }
│  │  │
│  │  ├─ {documentId}/
│  │  ├─ {documentId}/
│  │  └─ ...
│  │
│  ├─ exports/
│  │  │
│  │  ├─ {exportId}/
│  │  │  ├─ export.zip (entire room as ZIP)
│  │  │  └─ manifest.json
│  │  │
│  │  ├─ {exportId}/
│  │  └─ ...
│  │
│  └─ backups/
│     ├─ {backupId}/
│     └─ ...
│
├─ {organizationId}/
├─ {organizationId}/
└─ ...
```

### Metadata File Format

**File:** `/{orgId}/documents/{docId}/versions/{versionId}/metadata.json`

```json
{
  "versionId": "version_abc123",
  "documentId": "doc_xyz789",
  "organizationId": "org_abc123",
  "filename": "Financial_Statement_2025.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "fileSize": 245120,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "uploadedBy": "user_abc",
  "uploadedAt": "2026-03-14T10:30:00Z",
  "previewPipeline": {
    "status": "ACTIVE",
    "stages": {
      "scan": {
        "status": "complete",
        "result": "clean",
        "completedAt": "2026-03-14T10:31:00Z"
      },
      "convert": {
        "status": "complete",
        "tool": "gotenberg",
        "duration_ms": 2500,
        "completedAt": "2026-03-14T10:33:30Z"
      },
      "extract": {
        "status": "complete",
        "method": "pdftotext",
        "textLength": 5432,
        "ocrApplied": false,
        "completedAt": "2026-03-14T10:34:00Z"
      },
      "thumbnail": {
        "status": "complete",
        "duration_ms": 800,
        "completedAt": "2026-03-14T10:34:10Z"
      },
      "index": {
        "status": "complete",
        "duration_ms": 100,
        "completedAt": "2026-03-14T10:34:15Z"
      }
    }
  },
  "pageCount": 12,
  "tags": ["financial", "2025"],
  "retryCount": 0
}
```

### Path Helper Functions

```typescript
// lib/storage/storagePaths.ts

export function buildStoragePath(
  organizationId: string,
  documentId: string,
  versionId: string,
  type: 'original' | 'previewPdf' | 'thumbnail' | 'extractedText' | 'metadata',
  filename?: string
): string {
  const base = `/${organizationId}/documents/${documentId}/versions/${versionId}`;

  switch (type) {
    case 'original':
      return `${base}/original/${filename || 'document'}`;
    case 'previewPdf':
      return `${base}/preview/preview.pdf`;
    case 'thumbnail':
      // filename can be 'thumb-150.png' or 'preview-800.png'
      return `${base}/thumbnails/${filename}`;
    case 'extractedText':
      return `${base}/extracted/text.txt`;
    case 'metadata':
      return `${base}/metadata.json`;
    default:
      throw new Error(`Unknown storage path type: ${type}`);
  }
}

export function extractStoragePathInfo(path: string): {
  organizationId: string;
  documentId: string;
  versionId: string;
  type: string;
} {
  const match = path.match(/\/(\w+)\/documents\/(\w+)\/versions\/(\w+)\/(\w+)\//);

  if (!match) throw new Error(`Invalid storage path: ${path}`);

  return {
    organizationId: match[1],
    documentId: match[2],
    versionId: match[3],
    type: match[4], // 'original', 'preview', 'thumbnails', 'extracted'
  };
}
```

---

## Preview Dimensions and Quality

### Thumbnail Specifications

**150x150 (List View Icon)**

- Dimensions: 150px × 150px
- Format: PNG or JPEG
- Quality: JPEG q=80 (if JPEG)
- Fit: `fit-inside` (maintain aspect ratio, no stretch)
- DPI: 72 (screen resolution)
- Use case: File browser list icons, sidebar document previews
- Generation time: 2-5 seconds
- Generated from: first page of PDF

**800px Wide (Preview Pane)**

- Dimensions: 800px wide, auto height (maintain aspect ratio)
- Format: PNG for documents, JPEG for photos
- Quality: JPEG q=85 (if JPEG), PNG lossless
- Fit: Fit to 800px width, height scales proportionally
- DPI: 72 (screen resolution)
- Use case: Document preview pane before opening full viewer
- Generation time: 5-10 seconds
- Generated from: first page of PDF

### Full Preview PDF

**Specifications:**

- Format: PDF
- DPI: 150 (balance between quality and file size)
- Page Size: A4/Letter normalized (8.5" × 11" or A4 210mm × 297mm)
- Max Pages: 500 (truncate larger documents with "Preview truncated" notice)
- Quality: Standard PDF (not compressed)
- Use case: In-browser viewer (PDF.js or similar)
- Generation time: 30-120 seconds depending on file size

**Truncation Notice (if > 500 pages):**

```json
{
  "status": "ACTIVE",
  "pageCount": 1242,
  "previewPageCount": 500,
  "truncated": true,
  "truncationMessage": "This document has 1242 pages. Only the first 500 pages are shown in preview for performance. Download the full document to view all pages."
}
```

### Quality Settings by Format

| Input Format      | Thumbnail (150x150) | Preview (800px) | Full PDF        |
| ----------------- | ------------------- | --------------- | --------------- |
| PDF (native text) | PNG q80             | PNG lossless    | A4 150DPI       |
| DOCX/XLSX/PPTX    | JPEG q80            | JPEG q85        | A4 150DPI       |
| PNG/SVG           | PNG native          | PNG native      | A4 150DPI       |
| JPEG              | JPEG q80            | JPEG q85        | A4 150DPI       |
| TIFF (scanned)    | JPEG q75            | JPEG q80        | A4 150DPI + OCR |

### Generation Parameters

```typescript
// lib/preview/previewConfig.ts

export const PREVIEW_DIMENSIONS = {
  thumbnail: {
    width: 150,
    height: 150,
    fit: 'inside', // maintain aspect ratio
    format: 'jpeg',
    quality: 80,
    background: '#ffffff',
  },
  preview: {
    width: 800,
    height: 0, // auto
    fit: 'inside',
    format: 'jpeg',
    quality: 85,
    maxHeight: 1200,
  },
  fullPdf: {
    dpi: 150,
    pageSize: 'a4',
    quality: 'standard',
    maxPages: 500,
  },
};

// ImageMagick command generation
export function generateThumbnailCommand(
  inputPath: string,
  outputPath: string,
  spec: typeof PREVIEW_DIMENSIONS.thumbnail
): string {
  return [
    'convert',
    inputPath,
    '-resize',
    `${spec.width}x${spec.height}`,
    '-gravity',
    'center',
    '-background',
    spec.background,
    '-extent',
    `${spec.width}x${spec.height}`,
    '-quality',
    spec.quality.toString(),
    outputPath,
  ].join(' ');
}

export function generatePreviewCommand(
  inputPath: string,
  outputPath: string,
  spec: typeof PREVIEW_DIMENSIONS.preview
): string {
  return [
    'convert',
    inputPath,
    '-resize',
    `${spec.width}x${spec.maxHeight}`,
    '-quality',
    spec.quality.toString(),
    outputPath,
  ].join(' ');
}
```

---

## Error Handling and Fallbacks

### Stage Failure Scenarios

| Scenario               | Trigger                                   | Recovery                              | Final State                                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| **Upload timeout**     | FormData upload > 2min                    | Client retry                          | UPLOADING (cleaned after 24h)                                 |
| **Storage PUT fails**  | StorageProvider transient error           | 3 retries, exponential backoff        | UPLOADING (orphan cleanup)                                    |
| **Virus detected**     | ClamAV returns infected                   | Quarantine file, notify admin         | QUARANTINED                                                   |
| **Scan timeout**       | Scan job > 60s                            | 3 retries, exponential backoff        | FAILED (max retries)                                          |
| **Conversion fails**   | Gotenberg returns error or timeout > 120s | 2 retries, exponential backoff        | FAILED                                                        |
| **OCR fails**          | Tesseract timeout or crash                | Skip OCR; proceed without text        | EXTRACTING → ACTIVE (searchable but without OCR text)         |
| **Thumbnail fails**    | ImageMagick timeout > 30s                 | Generate generic icon                 | ACTIVE (with generic icon instead of screenshot)              |
| **Search index fails** | Database insert error                     | Retry; if max exceeded, skip indexing | ACTIVE (document viewable; not searchable until manual retry) |

### Fallback Strategies

**If Conversion Fails:**

```
✗ Convert to PDF failed
→ Show generic file-type icon (e.g., 📄 for unknown document)
→ Display message: "Preview unavailable. You can still download the original file."
→ Document marked FAILED; retry option available to admin
→ Original file still stored and downloadable
```

**If OCR Fails:**

```
✓ Document converted to PDF successfully
✗ OCR extraction failed
→ Proceed without full-text search
→ Document remains ACTIVE and viewable
→ Full-text search won't include this document until manual retry
→ Log error for admin review
→ Don't block user from viewing
```

**If Thumbnail Generation Fails:**

```
✓ PDF generated successfully
✗ Thumbnail generation failed
→ Use generic file-type icon (PDF icon, DOCX icon, etc.)
→ Display message: "Icon unavailable"
→ Proceed to ACTIVE state
→ Admin can manually retry thumbnail generation
```

**If Search Index Fails:**

```
✓ Document fully processed
✗ Search index update failed
→ Document still marked ACTIVE and viewable
→ Document won't appear in full-text search results
→ Log error; admin receives notification
→ Can be fixed via manual admin action or automatic retry
```

### Timeout Configuration

| Stage                         | Timeout | Rationale                                                        |
| ----------------------------- | ------- | ---------------------------------------------------------------- |
| **Scan (ClamAV)**             | 60s     | Most files scan quickly; large files need time                   |
| **Convert (Gotenberg)**       | 120s    | DOCX/XLSX conversions can be slow; 120s accounts for large files |
| **Extract (pdftotext + OCR)** | 60s     | Text extraction is fast; OCR slower but still reasonable         |
| **Thumbnail (ImageMagick)**   | 30s     | Simple image generation; should be fast                          |
| **Index (Database insert)**   | 10s     | Database operations are local/fast; network included             |

### Retry Policy

```typescript
const RETRY_POLICIES: Record<string, BullMQRetryPolicy> = {
  scan: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s
    timeout: 60000,
  },
  'preview:convert': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s
    timeout: 120000,
  },
  'preview:extract': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    timeout: 60000,
  },
  'preview:thumbnail': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    timeout: 30000,
  },
  'preview:index': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 10000,
  },
};

// After max retries exceeded:
async function markAsFailed(versionId: string, stage: string, error: Error) {
  await db.documentVersion.update({
    where: { id: versionId },
    data: {
      status: 'FAILED',
      failureStage: stage,
      failureReason: error.message,
      failureTimestamp: new Date(),
    },
  });

  const version = await db.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: true },
  });

  await eventBus.emit('document.preview_failed', {
    documentId: version.documentId,
    versionId,
    organizationId: version.document.organizationId,
    stage,
    error: error.message,
  });

  await notificationService.sendAdminAlert({
    type: 'PREVIEW_GENERATION_FAILED',
    documentId: version.documentId,
    documentName: version.document.name,
    stage,
    error: error.message,
    retryUrl: `/admin/documents/${version.documentId}/retry-preview`,
  });
}
```

### Admin UI: Manual Retry

**Location:** Document detail page (admin view)

```typescript
// app/admin/documents/[docId]/page.tsx
<button
  onClick={() => retryPreviewGeneration(docId, 'convert')}
  disabled={document.status !== 'FAILED'}
>
  Retry Preview Generation
</button>

async function retryPreviewGeneration(docId: string, fromStage: string) {
  const response = await fetch(`/api/admin/documents/${docId}/retry-preview`, {
    method: 'POST',
    body: JSON.stringify({ fromStage }),
  });

  if (response.ok) {
    // Reset version status and re-enqueue jobs
    const data = await response.json();
    toast.success(`Retrying from stage: ${fromStage}`);
  }
}

// app/api/admin/documents/[docId]/retry-preview/route.ts
export async function POST(request: NextRequest, context: { params: { docId: string } }) {
  const actor = await authenticateRequest(request);
  if (!actor || !isAdmin(actor)) return response.forbidden();

  const { fromStage } = await request.json();

  const document = await db.document.findFirst({
    where: {
      id: context.params.docId,
      organizationId: actor.organizationId,
    },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });

  if (!document) return response.notFound();

  const version = document.versions[0];

  // Re-enqueue jobs from specified stage
  const jobMap: Record<string, string> = {
    scan: 'scan',
    convert: 'preview:convert',
    extract: 'preview:extract',
    thumbnail: 'preview:thumbnail',
    index: 'preview:index',
  };

  if (!jobMap[fromStage]) {
    return response.badRequest(`Invalid stage: ${fromStage}`);
  }

  // Reset status
  await db.documentVersion.update({
    where: { id: version.id },
    data: { status: fromStage.toUpperCase() },
  });

  // Enqueue job
  await jobQueue.enqueue(jobMap[fromStage], {
    documentId: document.id,
    versionId: version.id,
    fileKey: version.fileBlob.storagePath,
  }, { priority: 'high' });

  return response.json({ success: true, jobName: jobMap[fromStage] });
}
```

---

## TypeScript Interfaces

### Upload Request/Response

```typescript
// lib/types/upload.ts

export interface DocumentUploadRequest {
  file: {
    filename: string;
    mimetype: string;
    data: Buffer;
    size: number;
  };
  roomId: string;
  folderId?: string;
  tags?: string[];
}

export interface DocumentUploadResponse {
  id: string;
  name: string;
  status: DocumentStatus;
  previewStatus: PreviewAssetStatus;
  uploadedAt: string;
  fileSize: number;
  mimeType: string;
}

export interface BulkUploadResponse {
  success: boolean;
  documents: DocumentUploadResponse[];
  errors?: Array<{
    filename: string;
    error: string;
  }>;
}

export type DocumentStatus =
  | 'UPLOADING'
  | 'SCANNING'
  | 'CONVERTING'
  | 'EXTRACTING'
  | 'THUMBNAIL'
  | 'INDEXING'
  | 'ACTIVE'
  | 'FAILED'
  | 'QUARANTINED';

export type PreviewAssetStatus =
  | 'PENDING'
  | 'SCANNING'
  | 'CONVERTING'
  | 'EXTRACTING'
  | 'THUMBNAIL'
  | 'INDEXING'
  | 'ACTIVE'
  | 'FAILED'
  | 'QUARANTINED';
```

### Storage Paths

```typescript
// lib/types/storage.ts

export interface StoragePaths {
  original: string;
  previewPdf: string;
  previewPages: string; // Pattern: /path/page-{0000}.png
  thumbnail150: string;
  preview800: string;
  extractedText: string;
  metadata: string;
}

export interface StoragePathInfo {
  organizationId: string;
  documentId: string;
  versionId: string;
  type: 'original' | 'preview' | 'thumbnails' | 'extracted' | 'metadata';
  filename?: string;
}

export interface FileMetadata {
  filename: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: Date;
  pageCount?: number;
  previewPipeline?: PreviewPipelineMetadata;
}

export interface PreviewPipelineMetadata {
  status: PreviewAssetStatus;
  stages: {
    scan?: StageMetadata;
    convert?: StageMetadata;
    extract?: StageMetadata;
    thumbnail?: StageMetadata;
    index?: StageMetadata;
  };
}

export interface StageMetadata {
  status: 'pending' | 'running' | 'complete' | 'failed';
  result?: string;
  duration_ms?: number;
  error?: string;
  completedAt?: Date;
}
```

### Job Payloads

```typescript
// lib/types/jobs.ts

export interface ScanJobPayload {
  documentId: string;
  versionId: string;
  fileKey: string;
}

export interface PreviewConvertJobPayload {
  documentId: string;
  versionId: string;
  fileKey: string;
  maxPages?: number;
}

export interface PreviewExtractJobPayload {
  documentId: string;
  versionId: string;
  fileKey: string;
  previewPdfKey: string;
}

export interface PreviewThumbnailJobPayload {
  documentId: string;
  versionId: string;
  previewPdfKey: string;
}

export interface PreviewIndexJobPayload {
  documentId: string;
  versionId: string;
}

export interface CleanupAbandonedUploadsJobPayload {
  // No specific data; job processes all orphaned uploads
}
```

### File Type Matrix

```typescript
// lib/types/fileTypes.ts

export interface SupportedFileType {
  ext: string;
  mimeType: string;
  category: 'PDF' | 'Office' | 'Image' | 'Text' | 'Data' | 'Video' | 'CAD';
  previewable: boolean;
  conversionTool?: 'gotenberg' | 'imagemagick' | 'liboffice' | 'inkscape';
  outputFormat?: 'pdf' | 'png' | 'jpeg';
  estimatedProcessingTime?: number; // seconds
}

export const SUPPORTED_FILE_TYPES: SupportedFileType[] = [
  {
    ext: 'pdf',
    mimeType: 'application/pdf',
    category: 'PDF',
    previewable: true,
    conversionTool: undefined,
    estimatedProcessingTime: 5,
  },
  {
    ext: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'Office',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 30,
  },
  // ... more types
];
```

### Provider Interfaces

```typescript
// lib/providers/types.ts

export interface StorageProvider {
  putObject(
    key: string,
    data: Buffer | ReadableStream,
    metadata?: Record<string, any>
  ): Promise<void>;

  getObject(key: string): Promise<Buffer>;

  getObjectStream(key: string): Promise<ReadableStream>;

  deleteObject(key: string): Promise<void>;

  getSignedUrl(
    key: string,
    action: 'GET' | 'PUT',
    options?: {
      expirySeconds?: number;
      contentDisposition?: 'inline' | 'attachment';
      responseHeaders?: Record<string, string>;
    }
  ): Promise<string>;

  exists(key: string): Promise<boolean>;

  listObjects(prefix: string): Promise<string[]>;
}

export interface ScanResult {
  scanId: string;
  status: 'clean' | 'infected' | 'error';
  threats?: Array<{
    name: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  error?: string;
  scannedAt: Date;
}

export interface ScanProvider {
  scan(fileKey: string): Promise<ScanResult>;
  getScanStatus(scanId: string): Promise<ScanResult>;
}

export interface PreviewResult {
  pdfKey: string;
  pageCount: number;
  size: number;
}

export interface PreviewOptions {
  pageCount?: number;
  quality?: 'low' | 'medium' | 'high';
}

export interface WatermarkOptions {
  placement?: 'diagonal' | 'corner' | 'margin';
  fontSize?: number;
  opacity?: number;
  color?: string;
}

export interface PreviewProvider {
  convertToPreview(
    sourceKey: string,
    sourceMimeType: string,
    options?: PreviewOptions
  ): Promise<PreviewResult>;

  generateThumbnail(
    pdfKey: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<Buffer>;

  extractText(sourceKey: string, sourceMimeType: string): Promise<string>;

  applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer>;

  getSupportedFormats(): Promise<string[]>;
}

export interface OCROptions {
  language?: string;
  quality?: 'fast' | 'normal' | 'high';
}

export interface OCREngine {
  performOCR(sourceKey: string, sourceFormat: string, options?: OCROptions): Promise<string>;

  requiresOCR(sourceKey: string, sourceFormat: string): Promise<boolean>;
}
```

---

## Implementation Checklist

### Phase 1: Upload Infrastructure (Week 1-2)

- [ ] Implement multipart form parsing (formidable)
- [ ] File validation (size, MIME type, filename sanitization)
- [ ] StorageProvider interface and local disk implementation
- [ ] Document and DocumentVersion models
- [ ] Upload API route (`POST /api/rooms/{roomId}/documents`)
- [ ] Basic error handling (validation errors, storage failures)
- [ ] Unit tests: file validation, path generation

### Phase 2: Preview Pipeline Jobs (Week 3-4)

- [ ] Job queue setup (BullMQ + Redis)
- [ ] ScanProvider interface (ClamAV implementation)
- [ ] PreviewProvider interface (GotenbergPreviewProvider)
- [ ] PreviewAsset model and schema
- [ ] Stage 1 worker: Scan
- [ ] Stage 2 worker: Convert to PDF
- [ ] Stage 3 worker: Extract text (with OCREngine)
- [ ] Stage 4 worker: Generate thumbnails
- [ ] Stage 5 worker: Update search index
- [ ] State machine transitions
- [ ] Error handling and retry logic
- [ ] Integration tests: full pipeline end-to-end

### Phase 3: Download and Preview (Week 5)

- [ ] Signed URL generation (StorageProvider)
- [ ] Download API routes (`GET /api/documents/{docId}/download` and `/preview`)
- [ ] Download audit event emission
- [ ] Preview URL with 5-minute client-side refresh
- [ ] Content-Disposition headers
- [ ] Stream-based download (no full buffering)
- [ ] Permission checks via PermissionEngine
- [ ] E2E tests: download flow, preview loading

### Phase 4: Admin UI and Cleanup (Week 6)

- [ ] Document status display and state indicators
- [ ] Upload progress UI (optional: SSE integration)
- [ ] Preview status in document detail page
- [ ] Admin retry button for FAILED documents
- [ ] Quarantine notification and review UI
- [ ] Abandoned upload cleanup job
- [ ] Monitor job queue health and failure rates
- [ ] E2E tests: admin UI workflows

### Phase 5: Testing and Documentation (Week 7)

- [ ] Security tests: tenant isolation (SEC-001)
- [ ] Virus detection tests (SEC-007)
- [ ] File integrity hash tests
- [ ] Preview generation load tests
- [ ] Concurrency tests: multiple simultaneous uploads
- [ ] Fallback handling tests (conversion failure, OCR failure, etc.)
- [ ] FILE_HANDLING.md finalization
- [ ] API documentation

---

## References

- **ARCHITECTURE.md:** Provider patterns, CoreService layer, event-driven design
- **DATABASE_SCHEMA.md:** Document, DocumentVersion, FileBlob, PreviewAsset, SearchIndex models
- **PERMISSION_MODEL.md:** Authorization checks for upload, download, view
- **EVENT_MODEL.md:** Event emission for audit trail
- **dataroom-feature-matrix-v6.md:** Features F006, F007, F008, F009, F101, F107, F132
- **BullMQ Documentation:** Job queue, retries, priorities
- **Gotenberg API:** Document conversion service
- **ClamAV Documentation:** Virus scanning
- **Tesseract OCR:** Text extraction from images/scanned PDFs

---

**Status:** Ready for implementation in Phase 0 (MVP) of VaultSpace
**Document Owner:** VaultSpace Core Team
**Last Reviewed:** 2026-03-14
