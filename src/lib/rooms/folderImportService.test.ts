import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceContext } from '@/services/types';

const mocks = vi.hoisted(() => ({
  withOrgContext: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock('@/lib/permissions', () => ({ getPermissionEngine: () => ({ can: mocks.can }) }));

import { commitFolderImport, FolderImportError, previewFolderImport } from './folderImportService';

const firstFile = {
  name: 'a.pdf',
  size: 1,
  type: 'application/pdf',
  arrayBuffer: async () => Uint8Array.of(1).buffer,
};
const secondFile = {
  name: 'b.pdf',
  size: 1,
  type: 'application/pdf',
  arrayBuffer: async () => Uint8Array.of(2).buffer,
};

function makeContext() {
  return {
    session: {
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'ADMIN' },
      user: { email: 'admin@example.test' },
    },
    eventBus: { emit: vi.fn().mockResolvedValue('event-1') },
    providers: {
      storage: { put: vi.fn(), delete: vi.fn() },
      job: { addJob: vi.fn() },
    },
  } as unknown as ServiceContext;
}

function makeTransaction() {
  return {
    room: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'room-1',
        accessionNumberingEnabled: false,
        accessionPrefix: null,
      }),
    },
    folder: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _max: { displayOrder: -1 } }),
      create: vi.fn().mockResolvedValueOnce({ id: 'folder-1' }),
    },
    document: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi
        .fn()
        .mockResolvedValueOnce({ id: 'document-1' })
        .mockResolvedValueOnce({ id: 'document-2' }),
      update: vi.fn(),
    },
    documentVersion: {
      create: vi
        .fn()
        .mockResolvedValueOnce({ id: 'version-1' })
        .mockResolvedValueOnce({ id: 'version-2' }),
    },
    fileBlob: { create: vi.fn() },
    roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    userOrganization: {
      findMany: vi.fn().mockResolvedValue([{ id: 'member-2', userId: 'other-admin' }]),
    },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe('folder import service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockResolvedValue(true);
  });

  it('rejects an over-depth batch before creating folders or documents', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const ctx = makeContext();

    await expect(
      previewFolderImport(ctx, 'room-1', [{ file: firstFile, path: 'A/B/C/D/a.pdf' }], null)
    ).rejects.toMatchObject({ code: 'FOLDER_DEPTH_EXCEEDED', status: 400 });
    expect(tx.folder.create).not.toHaveBeenCalled();
    expect(tx.document.create).not.toHaveBeenCalled();
  });

  it('requires room admin permission before disclosing the folder preview', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    mocks.can.mockResolvedValue(false);

    await expect(
      previewFolderImport(makeContext(), 'room-1', [{ file: firstFile, path: 'A/a.pdf' }], null)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } satisfies Partial<FolderImportError>);
    expect(tx.room.findFirst).not.toHaveBeenCalled();
    expect(tx.folder.findMany).not.toHaveBeenCalled();
  });

  it('reports a document collision at the same destination without creating folders', async () => {
    const tx = makeTransaction();
    tx.folder.findMany.mockResolvedValue([{ id: 'folder-1', path: '/A' }]);
    tx.document.findMany.mockResolvedValue([{ name: 'a.pdf', folderId: 'folder-1' }]);
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );

    await expect(
      previewFolderImport(makeContext(), 'room-1', [{ file: firstFile, path: 'A/a.pdf' }], null)
    ).rejects.toMatchObject({
      code: 'IMPORT_COLLISION',
      status: 409,
      details: {
        rejections: [{ sourcePath: 'A/a.pdf', reason: 'A document already exists at this path' }],
      },
    });
    expect(tx.folder.create).not.toHaveBeenCalled();
  });

  it('creates nested folders and schedules malware scans after a successful import', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const ctx = makeContext();

    const result = await commitFolderImport(
      ctx,
      'room-1',
      [{ file: firstFile, path: 'A/a.pdf' }],
      null
    );

    expect(result).toEqual({ documents: [{ id: 'document-1', name: 'a.pdf' }], newFolderCount: 1 });
    expect(tx.folder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ path: '/A', parentId: null, name: 'A' }),
    });
    expect(tx.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ folderId: 'folder-1', name: 'a.pdf' }),
    });
    expect(ctx.eventBus.emit).toHaveBeenCalledWith('DOCUMENT_UPLOADED', expect.any(Object), tx);
    expect(ctx.providers.job.addJob).toHaveBeenCalledWith(
      'high',
      'document.scan',
      expect.objectContaining({ documentId: 'document-1', organizationId: 'org-1' }),
      expect.any(Object)
    );
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userOrganizationId: 'member-2', sourceEventId: 'event-1' })],
      skipDuplicates: true,
    });
    expect(tx.notification.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.providers.job.addJob).mock.invocationCallOrder[0]!
    );
  });

  it('rolls back the import and cleans up uploaded objects if its notice write fails', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    tx.notification.createMany.mockRejectedValueOnce(
      new Error('notification database unavailable')
    );
    const ctx = makeContext();

    await expect(
      commitFolderImport(ctx, 'room-1', [{ file: firstFile, path: 'A/a.pdf' }], null)
    ).rejects.toThrow('notification database unavailable');
    expect(ctx.providers.storage.delete).toHaveBeenCalledWith(
      'documents',
      'org-1/documents/document-1/versions/version-1/original/a.pdf'
    );
    expect(ctx.providers.job.addJob).not.toHaveBeenCalled();
  });

  it('retains uploaded objects if the database commit result is uncertain', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => {
        await callback(tx);
        throw new Error('database connection lost during commit');
      }
    );
    const ctx = makeContext();

    await expect(
      commitFolderImport(ctx, 'room-1', [{ file: firstFile, path: 'A/a.pdf' }], null)
    ).rejects.toThrow('database connection lost during commit');
    expect(ctx.providers.storage.delete).not.toHaveBeenCalled();
    expect(ctx.providers.job.addJob).not.toHaveBeenCalled();
  });

  it('creates one room notice for a multi-file import', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const ctx = makeContext();
    vi.mocked(ctx.eventBus.emit)
      .mockResolvedValueOnce('folder-event')
      .mockResolvedValueOnce('event-1')
      .mockResolvedValueOnce('event-2');

    const result = await commitFolderImport(
      ctx,
      'room-1',
      [
        { file: firstFile, path: 'A/a.pdf' },
        { file: secondFile, path: 'A/b.pdf' },
      ],
      null
    );

    expect(result.documents).toHaveLength(2);
    expect(ctx.eventBus.emit).toHaveBeenCalledTimes(3);
    expect(ctx.providers.job.addJob).toHaveBeenCalledTimes(4);
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceEventId: 'event-1',
          title: '2 new documents in a room you manage',
          documentId: null,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('cleans up uploaded storage objects and skips jobs when a write fails', async () => {
    const tx = makeTransaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const ctx = makeContext();
    vi.mocked(ctx.providers.storage.put)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      commitFolderImport(
        ctx,
        'room-1',
        [
          { file: firstFile, path: 'A/a.pdf' },
          { file: secondFile, path: 'A/b.pdf' },
        ],
        null
      )
    ).rejects.toThrow('storage unavailable');
    expect(ctx.providers.storage.delete).toHaveBeenCalledTimes(2);
    expect(ctx.providers.job.addJob).not.toHaveBeenCalled();
  });
});
