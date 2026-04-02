/**
 * Binder / Index Export API (F013)
 *
 * GET /api/rooms/:roomId/export/index - Generate a table of contents / index
 *   ?format=html  - Returns printable HTML page
 *   (default)     - Returns JSON index data
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

interface BinderDocument {
  name: string;
  category: string | null;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
  versionCount: number;
  pageNumber: number;
}

interface BinderFolder {
  name: string;
  path: string;
  documents: BinderDocument[];
}

interface BinderIndex {
  room: { name: string; description: string | null };
  generatedAt: string;
  folders: BinderFolder[];
  totalDocuments: number;
  totalPages: number;
}

/**
 * GET /api/rooms/:roomId/export/index
 * Generate a binder index for the room's documents
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Admin only
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Get room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          name: true,
          description: true,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get all folders ordered by path
      const folders = await tx.folder.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
        },
        orderBy: { path: 'asc' },
        select: {
          id: true,
          name: true,
          path: true,
        },
      });

      // Get all active documents with version info, ordered by folder then name
      const documents = await tx.document.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        orderBy: [{ folderId: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          category: true,
          mimeType: true,
          fileSize: true,
          createdAt: true,
          folderId: true,
          totalVersions: true,
          versions: {
            where: { versionNumber: 1 },
            select: {
              uploadedByUser: {
                select: { firstName: true, lastName: true, email: true },
              },
              uploadedByEmail: true,
              createdAt: true,
            },
            take: 1,
          },
        },
      });

      return { room, folders, documents };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { room, folders, documents } = result;

    // Group documents by folder, maintaining order
    const folderDocMap = new Map<string, typeof documents>();
    // "Root" folder for documents without a folder
    const rootDocs: typeof documents = [];

    for (const doc of documents) {
      if (doc.folderId) {
        const existing = folderDocMap.get(doc.folderId) || [];
        existing.push(doc);
        folderDocMap.set(doc.folderId, existing);
      } else {
        rootDocs.push(doc);
      }
    }

    // Build binder structure with sequential page numbers
    let pageCounter = 1;

    const buildBinderDocs = (docs: typeof documents): BinderDocument[] => {
      return docs
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((doc) => {
          const firstVersion = doc.versions[0];
          const uploadedBy = firstVersion?.uploadedByUser
            ? `${firstVersion.uploadedByUser.firstName} ${firstVersion.uploadedByUser.lastName}`
            : firstVersion?.uploadedByEmail || 'Unknown';

          const binderDoc: BinderDocument = {
            name: doc.name,
            category: doc.category,
            mimeType: doc.mimeType,
            fileSize: Number(doc.fileSize),
            uploadedAt: (firstVersion?.createdAt || doc.createdAt).toISOString(),
            uploadedBy,
            versionCount: doc.totalVersions,
            pageNumber: pageCounter++,
          };
          return binderDoc;
        });
    };

    const binderFolders: BinderFolder[] = [];

    // Root documents first (no folder)
    if (rootDocs.length > 0) {
      binderFolders.push({
        name: '(Root)',
        path: '/',
        documents: buildBinderDocs(rootDocs),
      });
    }

    // Then folders in path order
    for (const folder of folders) {
      const docs = folderDocMap.get(folder.id) || [];
      if (docs.length > 0) {
        binderFolders.push({
          name: folder.name,
          path: folder.path,
          documents: buildBinderDocs(docs),
        });
      }
    }

    const totalDocuments = pageCounter - 1;
    const binderIndex: BinderIndex = {
      room: { name: room.name, description: room.description },
      generatedAt: new Date().toISOString(),
      folders: binderFolders,
      totalDocuments,
      totalPages: totalDocuments,
    };

    // Return HTML format if requested
    if (format === 'html') {
      const html = renderBinderHtml(binderIndex);
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Default: JSON
    return NextResponse.json(binderIndex);
  } catch (error) {
    console.error('[BinderExportAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to generate binder index' }, { status: 500 });
  }
}

/**
 * Render the binder index as a printable HTML page
 */
function renderBinderHtml(index: BinderIndex): string {
  const generatedDate = new Date(index.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatMimeType = (mime: string): string => {
    const map: Record<string, string> = {
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
      'application/msword': 'DOC',
      'application/vnd.ms-excel': 'XLS',
      'application/vnd.ms-powerpoint': 'PPT',
      'image/png': 'PNG',
      'image/jpeg': 'JPEG',
      'text/plain': 'TXT',
      'text/csv': 'CSV',
    };
    return map[mime] || mime.split('/').pop()?.toUpperCase() || mime;
  };

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  const formatCategory = (cat: string | null): string => {
    if (!cat) {
      return '&mdash;';
    }
    return escapeHtml(
      cat
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    );
  };

  // Build table rows
  let tableRows = '';
  for (const folder of index.folders) {
    // Folder header row
    tableRows += `
      <tr style="background-color: #f3f4f6;">
        <td colspan="8" style="padding: 8px 12px; font-weight: 600; font-size: 13px; color: #374151; border-bottom: 1px solid #d1d5db;">
          ${escapeHtml(folder.path)}
        </td>
      </tr>`;

    for (const doc of folder.documents) {
      const uploadDate = new Date(doc.uploadedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      tableRows += `
      <tr>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px;">${doc.pageNumber}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${escapeHtml(doc.name)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${escapeHtml(folder.name)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${formatCategory(doc.category)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${formatMimeType(doc.mimeType)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; text-align: right;">${formatFileSize(doc.fileSize)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${escapeHtml(doc.uploadedBy)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${uploadDate}</td>
      </tr>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Binder Index &mdash; ${escapeHtml(index.room.name)}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20px; }
      .no-print { display: none; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      max-width: 1100px;
      margin: 0 auto;
      padding: 40px 20px;
      font-size: 14px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 24px;
    }
    th {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 2px solid #374151;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #374151;
    }
    th:nth-child(1) { text-align: center; width: 40px; }
    th:nth-child(6) { text-align: right; }
  </style>
</head>
<body>
  <div style="margin-bottom: 32px;">
    <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">${escapeHtml(index.room.name)}</h1>
    ${index.room.description ? `<p style="margin: 0 0 8px 0; color: #6b7280;">${escapeHtml(index.room.description)}</p>` : ''}
    <p style="margin: 0; color: #9ca3af; font-size: 13px;">Binder Index &mdash; Generated ${generatedDate}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Document Name</th>
        <th>Folder</th>
        <th>Category</th>
        <th>Type</th>
        <th>Size</th>
        <th>Uploaded By</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #d1d5db; color: #6b7280; font-size: 13px;">
    <p style="margin: 0;">
      <strong>${index.totalDocuments}</strong> document${index.totalDocuments !== 1 ? 's' : ''} across
      <strong>${index.folders.length}</strong> folder${index.folders.length !== 1 ? 's' : ''}
    </p>
  </div>

  <div class="no-print" style="margin-top: 24px; text-align: center;">
    <button onclick="window.print()" style="padding: 8px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
      Print / Save as PDF
    </button>
  </div>
</body>
</html>`;
}
