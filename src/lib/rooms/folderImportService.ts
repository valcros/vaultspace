import crypto from 'crypto';

import type { Prisma } from '@prisma/client';

import { UPLOAD_CONFIG } from '@/lib/constants';
import { withOrgContext } from '@/lib/db';
import { getPermissionEngine } from '@/lib/permissions';
import { resolveMimeType } from '@/lib/fileTypes';
import { DOCUMENT_SCAN_JOB_OPTIONS } from '@/workers/types';
import type { ServiceContext } from '@/services/types';

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  prepareImportPaths,
  type ImportPath,
  type ImportPathIssue,
} from './folderImport';

export interface FolderImportFile {
  file: Pick<File, 'name' | 'size' | 'type'> & Partial<Pick<File, 'arrayBuffer'>>;
  path: string;
}

export class FolderImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

interface ImportPlan {
  paths: ImportPath[];
  basePath: string;
  existingFolders: Map<string, string>;
  newFolderPaths: string[];
  accessionNumberingEnabled: boolean;
  accessionPrefix: string | null;
}

function fullFolderPath(basePath: string, segments: string[]): string {
  return `${basePath}/${segments.join('/')}`.replace(/\/+$/, '') || '/';
}

function rejectIssues(issues: ImportPathIssue[]): never {
  throw new FolderImportError(
    'IMPORT_VALIDATION_FAILED',
    'One or more import paths are invalid',
    400,
    {
      rejections: issues,
    }
  );
}

async function buildPlan(
  tx: Prisma.TransactionClient,
  ctx: ServiceContext,
  roomId: string,
  files: FolderImportFile[],
  parentFolderId: string | null
): Promise<ImportPlan> {
  const { session } = ctx;
  const organizationId = session.organizationId;
  const canManage = await getPermissionEngine().can(
    { userId: session.userId, role: session.organization.role },
    'admin',
    { type: 'ROOM', organizationId, roomId },
    tx
  );
  if (!canManage) {
    throw new FolderImportError('FORBIDDEN', 'You cannot upload to this room', 403);
  }
  const room = await tx.room.findFirst({
    where: { id: roomId, organizationId, status: 'ACTIVE' },
    select: { id: true, accessionNumberingEnabled: true, accessionPrefix: true },
  });
  if (!room) {
    throw new FolderImportError('ROOM_NOT_AVAILABLE', 'Room not found or not active', 404);
  }

  const parent = parentFolderId
    ? await tx.folder.findFirst({
        where: { id: parentFolderId, organizationId, roomId },
        select: { path: true },
      })
    : null;
  if (parentFolderId && !parent) {
    throw new FolderImportError('FOLDER_NOT_FOUND', 'Destination folder not found', 404);
  }
  const basePath = parent?.path ?? '';
  const baseDepth = basePath.split('/').filter(Boolean).length;
  const prepared = prepareImportPaths(
    files.map((item) => item.path),
    files.map((item) => item.file.name),
    baseDepth
  );
  if (prepared.depthError) {
    const error = prepared.depthError.error;
    throw new FolderImportError(error.code, error.message, 400, error.details);
  }
  if (prepared.issues.length > 0) {
    rejectIssues(prepared.issues);
  }

  const requestedFolders = new Set<string>();
  for (const item of prepared.paths) {
    for (let length = 1; length <= item.folderSegments.length; length++) {
      requestedFolders.add(fullFolderPath(basePath, item.folderSegments.slice(0, length)));
    }
  }
  const requestedPaths = [...requestedFolders];
  const existing = requestedPaths.length
    ? await tx.folder.findMany({
        where: { roomId, organizationId, path: { in: requestedPaths } },
        select: { id: true, path: true },
      })
    : [];
  const existingFolders = new Map(existing.map((folder) => [folder.path, folder.id]));
  if (parentFolderId) {
    existingFolders.set(basePath, parentFolderId);
  }
  const newFolderPaths = requestedPaths
    .filter((path) => !existingFolders.has(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  // Documents already at their destination are collisions. Do not silently
  // create a second document with the same path/name during an import.
  const existingDocuments = await tx.document.findMany({
    where: {
      roomId,
      organizationId,
      status: 'ACTIVE',
      name: { in: prepared.paths.map((item) => item.filename) },
    },
    select: { name: true, folderId: true },
  });
  const collisions = prepared.paths
    .filter((item) => {
      const path = fullFolderPath(basePath, item.folderSegments);
      const folderId = item.folderSegments.length > 0 ? existingFolders.get(path) : parentFolderId;
      if (item.folderSegments.length > 0 && !folderId) {
        return false;
      }
      return existingDocuments.some(
        (document) => document.folderId === (folderId ?? null) && document.name === item.filename
      );
    })
    .map((item) => ({
      sourcePath: item.sourcePath,
      reason: 'A document already exists at this path',
    }));
  if (collisions.length > 0) {
    throw new FolderImportError('IMPORT_COLLISION', 'One or more documents already exist', 409, {
      rejections: collisions,
    });
  }
  return {
    paths: prepared.paths,
    basePath,
    existingFolders,
    newFolderPaths,
    accessionNumberingEnabled: room.accessionNumberingEnabled,
    accessionPrefix: room.accessionPrefix,
  };
}

function validateBatch(files: FolderImportFile[]): void {
  if (files.length === 0 || files.length > MAX_IMPORT_FILES) {
    throw new FolderImportError(
      'IMPORT_LIMIT_EXCEEDED',
      `Select between 1 and ${MAX_IMPORT_FILES} files`,
      400
    );
  }
  if (files.some(({ file }) => file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES || file.size < 0)) {
    throw new FolderImportError(
      'IMPORT_LIMIT_EXCEEDED',
      'A file exceeds the upload size limit',
      400
    );
  }
  if (files.reduce((sum, item) => sum + item.file.size, 0) > MAX_IMPORT_BYTES) {
    throw new FolderImportError(
      'IMPORT_LIMIT_EXCEEDED',
      `Folder imports are limited to ${MAX_IMPORT_BYTES / 1024 / 1024} MB per batch`,
      400
    );
  }
}

export async function previewFolderImport(
  ctx: ServiceContext,
  roomId: string,
  files: FolderImportFile[],
  parentFolderId: string | null
) {
  validateBatch(files);
  return withOrgContext(ctx.session.organizationId, async (tx) => {
    const plan = await buildPlan(tx, ctx, roomId, files, parentFolderId);
    return {
      fileCount: plan.paths.length,
      newFolders: plan.newFolderPaths,
      existingFolderCount: plan.existingFolders.size - (parentFolderId ? 1 : 0),
    };
  });
}

export async function commitFolderImport(
  ctx: ServiceContext,
  roomId: string,
  files: FolderImportFile[],
  parentFolderId: string | null
) {
  validateBatch(files);
  // Read the bounded request before opening a database transaction.
  if (files.some((item) => !item.file.arrayBuffer)) {
    throw new FolderImportError('IMPORT_VALIDATION_FAILED', 'File content is required', 400);
  }
  const data = await Promise.all(
    files.map(async (item) => Buffer.from(await item.file.arrayBuffer!()))
  );
  const writtenKeys: string[] = [];
  let committed: Array<{
    id: string;
    name: string;
    versionId: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
  }>;
  let newFolderCount = 0;

  try {
    committed = await withOrgContext(
      ctx.session.organizationId,
      async (tx) => {
        const plan = await buildPlan(tx, ctx, roomId, files, parentFolderId);
        newFolderCount = plan.newFolderPaths.length;
        const folderIds = new Map(plan.existingFolders);
        for (const path of plan.newFolderPaths) {
          const segments = path.split('/').filter(Boolean);
          const name = segments.at(-1)!;
          const parentPath = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '';
          const parentId = parentPath ? folderIds.get(parentPath) : null;
          const order = await tx.folder.aggregate({
            where: {
              roomId,
              organizationId: ctx.session.organizationId,
              parentId: parentId ?? null,
            },
            _max: { displayOrder: true },
          });
          const folder = await tx.folder.create({
            data: {
              organizationId: ctx.session.organizationId,
              roomId,
              parentId: parentId ?? null,
              name,
              path,
              displayOrder: (order._max.displayOrder ?? -1) + 1,
            },
          });
          folderIds.set(path, folder.id);
        }
        if (plan.newFolderPaths.length > 0) {
          await ctx.eventBus.emit(
            'ROOM_UPDATED',
            {
              roomId,
              description: `Imported ${plan.newFolderPaths.length} folders`,
              metadata: { folderImport: true, newFolderCount: plan.newFolderPaths.length },
            },
            tx
          );
        }

        const results = [];
        for (const [index, item] of plan.paths.entries()) {
          const file = files[index]!.file;
          const bytes = data[index]!;
          const folderPath = fullFolderPath(plan.basePath, item.folderSegments);
          const folderId =
            item.folderSegments.length > 0 ? folderIds.get(folderPath) : parentFolderId;
          const mimeType = resolveMimeType(file.name, file.type || '');
          const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          const versionHash = crypto
            .createHash('sha256')
            .update(`${fileSha256}:root:1`)
            .digest('hex');
          const accessionSeq = plan.accessionNumberingEnabled
            ? (
                await tx.room.update({
                  where: { id: roomId },
                  data: { lastAccessionSeq: { increment: 1 } },
                  select: { lastAccessionSeq: true },
                })
              ).lastAccessionSeq
            : null;
          const accessionNumber = accessionSeq
            ? `${plan.accessionPrefix?.trim() || 'DOC'}-${String(accessionSeq).padStart(4, '0')}`
            : null;
          const document = await tx.document.create({
            data: {
              organizationId: ctx.session.organizationId,
              roomId,
              folderId: folderId ?? null,
              name: file.name,
              originalFileName: file.name,
              mimeType,
              fileSize: BigInt(file.size),
              status: 'ACTIVE',
              totalVersions: 1,
              accessionSeq,
              accessionNumber,
            },
          });
          const safeName =
            file.name
              .replace(/[^\w\s\-.]/g, '')
              .replace(/\s+/g, '_')
              .slice(0, 255) || 'document';
          const version = await tx.documentVersion.create({
            data: {
              organizationId: ctx.session.organizationId,
              documentId: document.id,
              versionNumber: 1,
              fileName: safeName,
              mimeType,
              fileSize: BigInt(file.size),
              fileSha256,
              versionHash,
              scanStatus: 'PENDING',
              previewStatus: 'PENDING',
              uploadedByUserId: ctx.session.userId,
              uploadedByEmail: ctx.session.user.email,
            },
          });
          const storageKey = `${ctx.session.organizationId}/documents/${document.id}/versions/${version.id}/original/${safeName}`;
          writtenKeys.push(storageKey);
          await ctx.providers.storage.put('documents', storageKey, bytes);
          await tx.fileBlob.create({
            data: {
              organizationId: ctx.session.organizationId,
              versionId: version.id,
              storageKey,
              storageBucket: 'documents',
              isEncrypted: false,
            },
          });
          await tx.document.update({
            where: { id: document.id },
            data: { currentVersionId: version.id },
          });
          await ctx.eventBus.emit(
            'DOCUMENT_UPLOADED',
            {
              roomId,
              documentId: document.id,
              description: `Uploaded document: ${file.name}`,
              metadata: {
                versionId: version.id,
                fileName: file.name,
                fileSize: file.size,
                mimeType,
              },
            },
            tx
          );
          results.push({
            id: document.id,
            name: file.name,
            versionId: version.id,
            storageKey,
            mimeType,
            fileSize: file.size,
          });
        }
        return results;
      },
      { timeout: 180_000, maxWait: 10_000 }
    );
  } catch (error) {
    await Promise.allSettled(
      writtenKeys.map((key) => ctx.providers.storage.delete('documents', key))
    );
    throw error;
  }

  for (const document of committed) {
    try {
      await ctx.providers.job.addJob(
        'high',
        'document.scan',
        {
          documentId: document.id,
          versionId: document.versionId,
          organizationId: ctx.session.organizationId,
          storageKey: document.storageKey,
          contentType: document.mimeType,
          fileName: document.name,
          fileSizeBytes: document.fileSize,
        },
        DOCUMENT_SCAN_JOB_OPTIONS
      );
    } catch (error) {
      console.error('[FolderImport] Failed to queue document scan:', error);
      try {
        await withOrgContext(ctx.session.organizationId, (tx) =>
          tx.documentVersion.update({
            where: { id: document.versionId },
            data: { scanStatus: 'ERROR', scanError: 'Scan could not be queued' },
          })
        );
      } catch (statusError) {
        console.error('[FolderImport] Failed to record scan queue error:', statusError);
      }
    }
    try {
      await ctx.providers.job.addJob('normal', 'notify-document-uploaded', {
        organizationId: ctx.session.organizationId,
        roomId,
        documentId: document.id,
        uploaderId: ctx.session.userId,
      });
    } catch (error) {
      console.error('[FolderImport] Failed to queue notification:', error);
    }
  }
  return { documents: committed.map(({ id, name }) => ({ id, name })), newFolderCount };
}
