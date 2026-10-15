import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    organization: { findFirst: vi.fn() },
    userOrganization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    room: { findFirst: vi.fn() },
    roomViewDocument: { findFirst: vi.fn() },
    libraryDocument: { findFirst: vi.fn() },
    roomViewFolder: { findFirst: vi.fn() },
    libraryFolder: { findFirst: vi.fn() },
    libraryDocumentVersion: { findFirst: vi.fn() },
    libraryFileBlob: { findFirst: vi.fn() },
  };
  return { tx, withOrgContext: vi.fn() };
});

vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { resolvePublishedLibraryDocument } from './CompanyLibraryResolver';

const request = {
  organizationId: 'org-a',
  roomId: 'room-a',
  bindingId: 'binding-a',
  audience: { kind: 'ORGANIZATION_ADMIN' as const, userId: 'admin-a' },
};

const originalFlag = process.env['COMPANY_LIBRARY_ENABLED'];

beforeEach(() => {
  vi.resetAllMocks();
  process.env['COMPANY_LIBRARY_ENABLED'] = 'true';
  mocks.withOrgContext.mockImplementation((_org, fn) => fn(mocks.tx));
  mocks.tx.organization.findFirst.mockResolvedValue({ id: 'org-a' });
  mocks.tx.userOrganization.findUnique.mockResolvedValue({
    role: 'ADMIN',
    isActive: true,
    archivedAt: null,
  });
  mocks.tx.user.findUnique.mockResolvedValue({ isActive: true });
  mocks.tx.room.findFirst.mockResolvedValue({ id: 'room-a' });
  mocks.tx.roomViewDocument.findFirst.mockResolvedValue({
    id: 'binding-a',
    libraryDocumentId: 'doc-a',
    publishedVersionId: 'version-a',
    folderId: 'view-folder-a',
  });
  mocks.tx.libraryDocument.findFirst.mockResolvedValue({
    id: 'doc-a',
    folderId: 'library-folder-a',
  });
  mocks.tx.roomViewFolder.findFirst.mockResolvedValue({
    parentId: null,
    libraryFolderId: 'library-folder-a',
  });
  mocks.tx.libraryFolder.findFirst.mockResolvedValue({ parentId: null });
  mocks.tx.libraryDocumentVersion.findFirst.mockResolvedValue({
    id: 'version-a',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: BigInt(100),
  });
  mocks.tx.libraryFileBlob.findFirst.mockResolvedValue({
    storageKey: 'org-a/version-a',
    storageBucket: 'library',
  });
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env['COMPANY_LIBRARY_ENABLED'];
  } else {
    process.env['COMPANY_LIBRARY_ENABLED'] = originalFlag;
  }
});

describe('Company Library document resolver', () => {
  it('denies when the global flag is off or the audience is a viewer link', async () => {
    process.env['COMPANY_LIBRARY_ENABLED'] = 'false';
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    process.env['COMPANY_LIBRARY_ENABLED'] = 'true';
    expect(
      await resolvePublishedLibraryDocument({
        ...request,
        audience: { kind: 'VIEWER_LINK', linkId: 'link-a', viewSessionId: 'session-a' },
      })
    ).toBeNull();
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });

  it('requires enabled organization, active admin, active Company View room, and published binding', async () => {
    for (const [mock, value] of [
      [mocks.tx.organization.findFirst, null],
      [mocks.tx.userOrganization.findUnique, { role: 'VIEWER', isActive: true, archivedAt: null }],
      [mocks.tx.user.findUnique, { isActive: false }],
      [mocks.tx.room.findFirst, null],
      [mocks.tx.roomViewDocument.findFirst, null],
    ] as const) {
      mock.mockResolvedValueOnce(value);
      expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    }
    expect(mocks.tx.room.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          mode: 'COMPANY_VIEW',
          status: 'ACTIVE',
        }),
      })
    );
    expect(mocks.tx.roomViewDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: 'room-a', status: 'PUBLISHED' }),
      })
    );
  });

  it('denies hidden placement ancestors, archived canonical ancestors, and cycles', async () => {
    mocks.tx.roomViewFolder.findFirst.mockResolvedValueOnce(null);
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    mocks.tx.libraryFolder.findFirst.mockResolvedValueOnce(null);
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    mocks.tx.roomViewFolder.findFirst.mockResolvedValueOnce({
      parentId: null,
      libraryFolderId: 'mapped-folder-a',
    });
    mocks.tx.libraryFolder.findFirst.mockImplementationOnce(({ where }) =>
      Promise.resolve(where.id === 'mapped-folder-a' ? null : { parentId: null })
    );
    mocks.tx.libraryFolder.findFirst.mockResolvedValueOnce(null);
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    mocks.tx.roomViewFolder.findFirst.mockResolvedValue({ parentId: 'view-folder-a' });
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    expect(mocks.tx.roomViewFolder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hiddenAt: null,
          organizationId: 'org-a',
          roomId: 'room-a',
        }),
      })
    );
    expect(mocks.tx.libraryFolder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null, organizationId: 'org-a' }),
      })
    );
  });

  it('denies a nonclean version or absent blob and returns only the exact pinned version', async () => {
    mocks.tx.libraryDocumentVersion.findFirst.mockResolvedValueOnce(null);
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    mocks.tx.libraryFileBlob.findFirst.mockResolvedValueOnce(null);
    expect(await resolvePublishedLibraryDocument(request)).toBeNull();
    expect(await resolvePublishedLibraryDocument(request)).toEqual({
      organizationId: 'org-a',
      roomId: 'room-a',
      bindingId: 'binding-a',
      libraryDocumentId: 'doc-a',
      publishedVersionId: 'version-a',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: BigInt(100),
      storageKey: 'org-a/version-a',
      storageBucket: 'library',
    });
    expect(mocks.tx.libraryDocumentVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'version-a',
          organizationId: 'org-a',
          documentId: 'doc-a',
          scanStatus: 'CLEAN',
        },
      })
    );
  });
});
