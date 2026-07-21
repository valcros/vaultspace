/**
 * DocumentService Unit Tests
 *
 * Tests document lifecycle: upload validation, listing.
 * Mocks database, storage, event bus, and job queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentService } from './DocumentService';
import type { ServiceContext } from './types';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: vi.fn(() => ({
    can: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock transaction
const mockTx = {
  room: { findFirst: vi.fn(), update: vi.fn() },
  folder: { findFirst: vi.fn() },
  document: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  documentVersion: { create: vi.fn(), findFirst: vi.fn() },
  fileBlob: { create: vi.fn() },
};

const mockEventBus = {
  emit: vi.fn().mockResolvedValue(undefined),
};

const mockStorage = {
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  exists: vi.fn().mockResolvedValue(true),
  delete: vi.fn(),
  getSignedUrl: vi.fn(),
};

const mockJob = {
  addJob: vi.fn().mockResolvedValue(undefined),
};

function createMockContext(): ServiceContext {
  return {
    session: {
      sessionId: 'sess-1',
      userId: 'user-1',
      organizationId: 'org-1',
      user: {
        id: 'user-1',
        email: 'admin@test.com',
        firstName: 'Test',
        lastName: 'Admin',
        isActive: true,
      },
      organization: {
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        role: 'ADMIN' as const,
        canManageUsers: true,
        canManageRooms: true,
      },
      expiresAt: new Date(Date.now() + 86400000),
      issuedAt: new Date(),
    },
    requestId: 'req-test-1',
    eventBus: mockEventBus as unknown as ServiceContext['eventBus'],
    providers: {
      storage: mockStorage,
      job: mockJob,
    } as unknown as ServiceContext['providers'],
  };
}

describe('DocumentService', () => {
  let service: DocumentService;
  let ctx: ServiceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DocumentService();
    ctx = createMockContext();
  });

  describe('upload', () => {
    const validFile = {
      filename: 'test-document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      data: Buffer.from('fake pdf content'),
    };

    it('should upload a valid document', async () => {
      const mockDoc = {
        id: 'doc-1',
        organizationId: 'org-1',
        roomId: 'room-1',
        name: 'test-document.pdf',
        status: 'ACTIVE',
      };
      const mockVersion = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionNumber: 1,
        fileName: 'test-document.pdf',
      };

      mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', status: 'ACTIVE' });
      mockTx.document.create.mockResolvedValue(mockDoc);
      mockTx.documentVersion.create.mockResolvedValue(mockVersion);
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue(mockDoc);

      const result = await service.upload(ctx, {
        roomId: 'room-1',
        file: validFile,
      });

      expect(result.id).toBe('doc-1');
      expect(result.latestVersion).toBeDefined();
      expect(mockStorage.put).toHaveBeenCalled();
      expect(mockJob.addJob).toHaveBeenCalledWith(
        'high',
        'document.scan',
        expect.objectContaining({ documentId: 'doc-1' }),
        expect.objectContaining({
          attempts: 10,
          backoff: {
            type: 'exponential',
            delay: 10000,
          },
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'DOCUMENT_UPLOADED',
        expect.objectContaining({ documentId: 'doc-1' })
      );
    });

    it('accepts any file type, even one the app cannot preview (e.g. video)', async () => {
      const mockDoc = {
        id: 'doc-1',
        organizationId: 'org-1',
        roomId: 'room-1',
        name: 'clip.mp4',
        status: 'ACTIVE',
      };
      const mockVersion = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionNumber: 1,
        fileName: 'clip.mp4',
      };
      mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', status: 'ACTIVE' });
      mockTx.document.create.mockResolvedValue(mockDoc);
      mockTx.documentVersion.create.mockResolvedValue(mockVersion);
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue(mockDoc);

      const videoFile = { ...validFile, filename: 'clip.mp4', mimeType: 'video/mp4' };
      const result = await service.upload(ctx, { roomId: 'room-1', file: videoFile });
      expect(result.id).toBe('doc-1');
    });

    it('should reject files exceeding size limit', async () => {
      const hugeFile = { ...validFile, size: 600 * 1024 * 1024 }; // 600MB

      await expect(service.upload(ctx, { roomId: 'room-1', file: hugeFile })).rejects.toThrow(
        'File size exceeds'
      );
    });

    it('should reject empty filename', async () => {
      const noName = { ...validFile, filename: '' };

      await expect(service.upload(ctx, { roomId: 'room-1', file: noName })).rejects.toThrow(
        'Filename is required'
      );
    });

    it('should reject filename over 255 characters', async () => {
      const longName = { ...validFile, filename: 'a'.repeat(256) + '.pdf' };

      await expect(service.upload(ctx, { roomId: 'room-1', file: longName })).rejects.toThrow(
        'Filename exceeds 255 characters'
      );
    });

    it('should calculate SHA-256 hash of uploaded file', async () => {
      mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', status: 'ACTIVE' });
      mockTx.document.create.mockResolvedValue({ id: 'doc-1' });
      mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1', fileName: 'test.pdf' });
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue({});

      await service.upload(ctx, { roomId: 'room-1', file: validFile });

      // Verify version was created with a SHA-256 hash
      expect(mockTx.documentVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        })
      );
    });

    it('should queue virus scan job after upload', async () => {
      mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', status: 'ACTIVE' });
      mockTx.document.create.mockResolvedValue({ id: 'doc-1' });
      mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1', fileName: 'test.pdf' });
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue({});

      await service.upload(ctx, { roomId: 'room-1', file: validFile });

      expect(mockJob.addJob).toHaveBeenCalledWith(
        'high',
        'document.scan',
        expect.objectContaining({
          documentId: 'doc-1',
          versionId: 'ver-1',
          organizationId: 'org-1',
        }),
        expect.objectContaining({
          attempts: 10,
          backoff: {
            type: 'exponential',
            delay: 10000,
          },
        })
      );
    });

    it('assigns an immutable accession number when the room opts in', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        status: 'ACTIVE',
        accessionNumberingEnabled: true,
      });
      mockTx.room.update.mockResolvedValue({ lastAccessionSeq: 7, accessionPrefix: 'BSD' });
      mockTx.document.create.mockResolvedValue({ id: 'doc-1' });
      mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1', fileName: 'test.pdf' });
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue({});

      await service.upload(ctx, { roomId: 'room-1', file: validFile });

      // Counter is incremented atomically inside the transaction.
      expect(mockTx.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-1' },
          data: { lastAccessionSeq: { increment: 1 } },
        })
      );
      // Document is stamped with prefix + zero-padded sequence.
      expect(mockTx.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accessionNumber: 'BSD-0007',
            accessionSeq: 7,
          }),
        })
      );
    });

    it('does not assign an accession number when the room has numbering off', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        status: 'ACTIVE',
        accessionNumberingEnabled: false,
      });
      mockTx.document.create.mockResolvedValue({ id: 'doc-1' });
      mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1', fileName: 'test.pdf' });
      mockTx.fileBlob.create.mockResolvedValue({});
      mockTx.document.update.mockResolvedValue({});

      await service.upload(ctx, { roomId: 'room-1', file: validFile });

      expect(mockTx.room.update).not.toHaveBeenCalled();
      expect(mockTx.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accessionNumber: null, accessionSeq: null }),
        })
      );
    });
  });

  describe('list', () => {
    it('should return paginated documents', async () => {
      const docs = [
        { id: 'd1', name: 'File 1.pdf', versions: [{ id: 'v1' }] },
        { id: 'd2', name: 'File 2.docx', versions: [] },
      ];

      mockTx.document.count.mockResolvedValue(2);
      mockTx.document.findMany.mockResolvedValue(docs);

      const result = await service.list(ctx, { roomId: 'room-1' });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should scope documents to organization', async () => {
      mockTx.document.count.mockResolvedValue(0);
      mockTx.document.findMany.mockResolvedValue([]);

      await service.list(ctx, { roomId: 'room-1' }).catch(() => {
        // May fail with empty array, that's fine for this test
      });

      expect(mockTx.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            roomId: 'room-1',
          }),
        })
      );
    });
  });
});
