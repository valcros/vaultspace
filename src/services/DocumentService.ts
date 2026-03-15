/**
 * Document Service
 *
 * Handles document lifecycle: upload, versioning, metadata, deletion.
 * All mutations emit events for audit trail.
 */

import crypto from 'crypto';
import path from 'path';

import type { Document, DocumentVersion, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { NotFoundError, UploadError, ValidationError } from '@/lib/errors';
import { getPermissionEngine } from '@/lib/permissions';
import { UPLOAD_CONFIG } from '@/lib/constants';

import type { PaginatedResult, PaginationOptions, ServiceContext } from './types';

/**
 * Supported MIME types for upload
 */
const SUPPORTED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  // Text
  'text/plain',
  'text/csv',
  'text/markdown',
]);

/**
 * File input for upload
 */
export interface FileInput {
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

/**
 * Upload options
 */
export interface UploadOptions {
  roomId: string;
  folderId?: string;
  file: FileInput;
  tags?: string[];
}

/**
 * Document with version info
 */
export interface DocumentWithVersion extends Document {
  latestVersion: DocumentVersion | null;
}

/**
 * Document list filters
 */
export interface DocumentListOptions extends PaginationOptions {
  roomId: string;
  folderId?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  search?: string;
}

/**
 * Sanitize filename for storage
 */
function sanitizeFilename(input: string): string {
  const basename = path.basename(input);
  const sanitized = basename
    .replace(/[^\w\s\-.]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 255);
  return sanitized || 'document';
}

/**
 * Generate storage key for a document version
 */
function generateStorageKey(
  organizationId: string,
  documentId: string,
  versionId: string,
  filename: string
): string {
  return `${organizationId}/documents/${documentId}/versions/${versionId}/original/${filename}`;
}

/**
 * Calculate SHA-256 hash of file data
 */
function calculateHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculate version hash for integrity chain
 */
function calculateVersionHash(fileSha256: string, parentHash: string | null, versionNumber: number): string {
  const input = `${fileSha256}:${parentHash ?? 'root'}:${versionNumber}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

export class DocumentService {
  /**
   * Upload a new document
   * @mutating
   */
  async upload(ctx: ServiceContext, options: UploadOptions): Promise<DocumentWithVersion> {
    const { session, eventBus, providers } = ctx;
    const { roomId, folderId, file, tags } = options;
    const organizationId = session.organizationId;

    // Check permissions
    const permissionEngine = getPermissionEngine();
    const canUpload = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'admin',
      { type: 'ROOM', organizationId, roomId }
    );

    if (!canUpload) {
      throw new UploadError('You do not have permission to upload to this room');
    }

    // Validate room exists and is active
    const room = await db.room.findFirst({
      where: { id: roomId, organizationId, status: 'ACTIVE' },
    });

    if (!room) {
      throw new NotFoundError('Room not found or not active');
    }

    // Validate folder if provided
    if (folderId) {
      const folder = await db.folder.findFirst({
        where: { id: folderId, organizationId, roomId },
      });

      if (!folder) {
        throw new NotFoundError('Folder not found');
      }
    }

    // Validate file
    this.validateFile(file);

    // Calculate hash and sanitize filename
    const fileSha256 = calculateHash(file.data);
    const sanitizedFilename = sanitizeFilename(file.filename);
    const versionHash = calculateVersionHash(fileSha256, null, 1);

    // Create document and version in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create the document
      const document = await tx.document.create({
        data: {
          organizationId,
          roomId,
          folderId,
          name: file.filename,
          mimeType: file.mimeType,
          fileSize: BigInt(file.size),
          originalFileName: file.filename,
          status: 'ACTIVE',
          tags: tags ?? [],
          totalVersions: 1,
        },
      });

      // Create the first version
      const version = await tx.documentVersion.create({
        data: {
          organizationId,
          documentId: document.id,
          versionNumber: 1,
          fileName: sanitizedFilename,
          mimeType: file.mimeType,
          fileSize: BigInt(file.size),
          fileSha256,
          versionHash,
          scanStatus: 'PENDING',
          previewStatus: 'PENDING',
          uploadedByUserId: session.userId,
          uploadedByEmail: session.user.email,
        },
      });

      // Generate storage key
      const storageKey = generateStorageKey(organizationId, document.id, version.id, sanitizedFilename);

      // Upload to storage
      await providers.storage.put('documents', storageKey, file.data);

      // Create FileBlob record
      await tx.fileBlob.create({
        data: {
          organizationId,
          versionId: version.id,
          storageKey,
          storageBucket: 'documents',
          isEncrypted: false,
        },
      });

      // Update document with current version
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });

      return { document, version };
    });

    // Emit upload event
    await eventBus.emit('DOCUMENT_UPLOADED', {
      roomId,
      documentId: result.document.id,
      description: `Uploaded document: ${file.filename}`,
      metadata: {
        versionId: result.version.id,
        fileName: file.filename,
        fileSize: file.size,
        mimeType: file.mimeType,
      },
    });

    // Queue background jobs for scanning and preview
    await providers.job.addJob('scan', 'virus-scan', {
      documentId: result.document.id,
      versionId: result.version.id,
      organizationId,
    });

    await providers.job.addJob('preview', 'generate-preview', {
      documentId: result.document.id,
      versionId: result.version.id,
      organizationId,
    });

    return {
      ...result.document,
      latestVersion: result.version,
    };
  }

  /**
   * Validate file before upload
   */
  private validateFile(file: FileInput): void {
    // Check file size
    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `File size exceeds maximum allowed (${UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`
      );
    }

    // Check MIME type
    if (!SUPPORTED_MIME_TYPES.has(file.mimeType)) {
      throw new ValidationError(`Unsupported file type: ${file.mimeType}`);
    }

    // Check filename
    if (!file.filename || file.filename.length === 0) {
      throw new ValidationError('Filename is required');
    }

    if (file.filename.length > 255) {
      throw new ValidationError('Filename exceeds 255 characters');
    }
  }

  /**
   * Get a document by ID
   * @readonly
   */
  async getById(ctx: ServiceContext, documentId: string): Promise<DocumentWithVersion | null> {
    const { session } = ctx;

    const document = await db.document.findFirst({
      where: {
        id: documentId,
        organizationId: session.organizationId,
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    if (!document) {
      return null;
    }

    // Check permissions
    const permissionEngine = getPermissionEngine();
    const canView = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'view',
      {
        type: 'DOCUMENT',
        organizationId: session.organizationId,
        roomId: document.roomId,
        documentId,
      }
    );

    if (!canView) {
      return null;
    }

    return {
      ...document,
      latestVersion: document.versions[0] ?? null,
    };
  }

  /**
   * List documents in a room/folder
   * @readonly
   */
  async list(ctx: ServiceContext, options: DocumentListOptions): Promise<PaginatedResult<DocumentWithVersion>> {
    const { session } = ctx;
    const { roomId, folderId, status, search, offset = 0, limit = 50 } = options;

    // Build where clause
    const where: Prisma.DocumentWhereInput = {
      organizationId: session.organizationId,
      roomId,
      ...(folderId !== undefined && { folderId }),
      ...(status && { status }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' },
      }),
    };

    // Get total count
    const total = await db.document.count({ where });

    // Get documents with latest version
    const documents = await db.document.findMany({
      where,
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const items: DocumentWithVersion[] = documents.map((doc) => ({
      ...doc,
      latestVersion: doc.versions[0] ?? null,
    }));

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Move a document to a different folder
   * @mutating
   */
  async move(ctx: ServiceContext, documentId: string, targetFolderId: string | null): Promise<Document> {
    const { session, eventBus } = ctx;

    // Get the document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        organizationId: session.organizationId,
      },
    });

    if (!document) {
      throw new NotFoundError('Document not found');
    }

    // Check permissions
    const permissionEngine = getPermissionEngine();
    const canAdmin = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'admin',
      {
        type: 'DOCUMENT',
        organizationId: session.organizationId,
        roomId: document.roomId,
        documentId,
      }
    );

    if (!canAdmin) {
      throw new UploadError('You do not have permission to move this document');
    }

    // Validate target folder if provided
    if (targetFolderId) {
      const folder = await db.folder.findFirst({
        where: {
          id: targetFolderId,
          organizationId: session.organizationId,
          roomId: document.roomId,
        },
      });

      if (!folder) {
        throw new NotFoundError('Target folder not found');
      }
    }

    const previousFolderId = document.folderId;

    // Update document
    const updated = await db.document.update({
      where: { id: documentId },
      data: { folderId: targetFolderId },
    });

    // Emit event
    await eventBus.emit('DOCUMENT_MOVED', {
      roomId: document.roomId,
      documentId,
      description: `Moved document: ${document.name}`,
      metadata: {
        previousFolderId,
        newFolderId: targetFolderId,
      },
    });

    return updated;
  }

  /**
   * Soft delete a document (move to trash)
   * @mutating
   */
  async delete(ctx: ServiceContext, documentId: string): Promise<Document> {
    const { session, eventBus } = ctx;

    // Get the document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        organizationId: session.organizationId,
      },
    });

    if (!document) {
      throw new NotFoundError('Document not found');
    }

    // Check permissions
    const permissionEngine = getPermissionEngine();
    const canDelete = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'delete',
      {
        type: 'DOCUMENT',
        organizationId: session.organizationId,
        roomId: document.roomId,
        documentId,
      }
    );

    if (!canDelete) {
      throw new UploadError('You do not have permission to delete this document');
    }

    // Soft delete (move to DELETED status)
    const updated = await db.document.update({
      where: { id: documentId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });

    // Emit event
    await eventBus.emit('DOCUMENT_DELETED', {
      roomId: document.roomId,
      documentId,
      description: `Deleted document: ${document.name}`,
    });

    return updated;
  }

  /**
   * Restore a deleted document
   * @mutating
   */
  async restore(ctx: ServiceContext, documentId: string): Promise<Document> {
    const { session, eventBus } = ctx;

    // Get the document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
        organizationId: session.organizationId,
        status: 'DELETED',
      },
    });

    if (!document) {
      throw new NotFoundError('Document not found or not in trash');
    }

    // Check permissions
    const permissionEngine = getPermissionEngine();
    const canRestore = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'admin',
      {
        type: 'ROOM',
        organizationId: session.organizationId,
        roomId: document.roomId,
      }
    );

    if (!canRestore) {
      throw new UploadError('You do not have permission to restore this document');
    }

    // Restore document
    const updated = await db.document.update({
      where: { id: documentId },
      data: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    // Emit event
    await eventBus.emit('DOCUMENT_RESTORED', {
      roomId: document.roomId,
      documentId,
      description: `Restored document: ${document.name}`,
    });

    return updated;
  }
}

// Export singleton instance
export const documentService = new DocumentService();
