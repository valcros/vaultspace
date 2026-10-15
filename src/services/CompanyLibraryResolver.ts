import { withOrgContext } from '@/lib/db';

export type CompanyLibraryAudience =
  | { kind: 'ORGANIZATION_ADMIN'; userId: string }
  | { kind: 'VIEWER_LINK'; linkId: string; viewSessionId: string };

export interface PublishedLibraryDocumentRequest {
  organizationId: string;
  roomId: string;
  bindingId: string;
  audience: CompanyLibraryAudience;
}

export interface ResolvedPublishedLibraryDocument {
  organizationId: string;
  roomId: string;
  bindingId: string;
  libraryDocumentId: string;
  publishedVersionId: string;
  fileName: string;
  mimeType: string;
  fileSize: bigint;
  storageKey: string;
  storageBucket: string;
}

/**
 * Internal, deny-by-default foundation for a published Company View binding.
 * The viewer-link branch remains closed until links and viewer sessions carry
 * view-binding identities in the later serving-surface increment.
 */
export async function resolvePublishedLibraryDocument(
  input: PublishedLibraryDocumentRequest
): Promise<ResolvedPublishedLibraryDocument | null> {
  if (
    process.env['COMPANY_LIBRARY_ENABLED'] !== 'true' ||
    input.audience.kind !== 'ORGANIZATION_ADMIN'
  ) {
    return null;
  }
  const adminUserId = input.audience.userId;

  return withOrgContext(input.organizationId, async (tx) => {
    const organization = await tx.organization.findFirst({
      where: { id: input.organizationId, isActive: true, companyLibraryEnabled: true },
      select: { id: true },
    });
    if (!organization) {
      return null;
    }

    const membership = await tx.userOrganization.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: adminUserId,
        },
      },
      select: { role: true, isActive: true, archivedAt: true },
    });
    const user = await tx.user.findUnique({
      where: { id: adminUserId },
      select: { isActive: true },
    });
    if (
      membership?.role !== 'ADMIN' ||
      !membership.isActive ||
      membership.archivedAt ||
      !user?.isActive
    ) {
      return null;
    }

    const room = await tx.room.findFirst({
      where: {
        id: input.roomId,
        organizationId: input.organizationId,
        mode: 'COMPANY_VIEW',
        status: 'ACTIVE',
        archivedAt: null,
        closedAt: null,
      },
      select: { id: true },
    });
    if (!room) {
      return null;
    }

    const binding = await tx.roomViewDocument.findFirst({
      where: {
        id: input.bindingId,
        organizationId: input.organizationId,
        roomId: input.roomId,
        status: 'PUBLISHED',
        publishedVersionId: { not: null },
      },
      select: {
        id: true,
        libraryDocumentId: true,
        publishedVersionId: true,
        folderId: true,
      },
    });
    if (!binding?.publishedVersionId) {
      return null;
    }

    const document = await tx.libraryDocument.findFirst({
      where: {
        id: binding.libraryDocumentId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      select: { id: true, folderId: true },
    });
    if (!document) {
      return null;
    }

    // A room placement or canonical ancestor can be hidden or archived after
    // publication. Check both trees at serve time and fail closed on cycles.
    const seenViewFolders = new Set<string>();
    let viewFolderId = binding.folderId;
    while (viewFolderId) {
      if (seenViewFolders.has(viewFolderId) || seenViewFolders.size >= 100) {
        return null;
      }
      seenViewFolders.add(viewFolderId);
      const folder = await tx.roomViewFolder.findFirst({
        where: {
          id: viewFolderId,
          organizationId: input.organizationId,
          roomId: input.roomId,
          hiddenAt: null,
        },
        select: { parentId: true },
      });
      if (!folder) {
        return null;
      }
      viewFolderId = folder.parentId;
    }

    const seenLibraryFolders = new Set<string>();
    let libraryFolderId = document.folderId;
    while (libraryFolderId) {
      if (seenLibraryFolders.has(libraryFolderId) || seenLibraryFolders.size >= 100) {
        return null;
      }
      seenLibraryFolders.add(libraryFolderId);
      const folder = await tx.libraryFolder.findFirst({
        where: { id: libraryFolderId, organizationId: input.organizationId, archivedAt: null },
        select: { parentId: true },
      });
      if (!folder) {
        return null;
      }
      libraryFolderId = folder.parentId;
    }

    const version = await tx.libraryDocumentVersion.findFirst({
      where: {
        id: binding.publishedVersionId,
        organizationId: input.organizationId,
        documentId: document.id,
        scanStatus: 'CLEAN',
      },
      select: { id: true, fileName: true, mimeType: true, fileSize: true },
    });
    if (!version) {
      return null;
    }

    const blob = await tx.libraryFileBlob.findFirst({
      where: { organizationId: input.organizationId, versionId: version.id },
      select: { storageKey: true, storageBucket: true },
    });
    if (!blob?.storageKey) {
      return null;
    }

    return {
      organizationId: input.organizationId,
      roomId: input.roomId,
      bindingId: binding.id,
      libraryDocumentId: document.id,
      publishedVersionId: version.id,
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
      storageKey: blob.storageKey,
      storageBucket: blob.storageBucket,
    };
  });
}
