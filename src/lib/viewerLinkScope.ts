import type { LinkScope, Prisma } from '@prisma/client';

interface ViewerLinkScope {
  scope: LinkScope;
  scopedFolderId: string | null;
  scopedDocumentId: string | null;
}

interface ViewerDocumentScopeTarget {
  id: string;
  folderId: string | null;
}

/**
 * Determine whether a viewer link can access a room-scoped document.
 *
 * The caller must first load the active document by both document id and the
 * viewer session's room id. Folder authorization is reconstructed only through
 * immutable parent ids, never through a caller-provided folder id or display
 * path. Missing parents and hierarchy cycles fail closed.
 */
export async function canViewerLinkAccessDocument(
  tx: Prisma.TransactionClient,
  link: ViewerLinkScope,
  roomId: string,
  document: ViewerDocumentScopeTarget
): Promise<boolean> {
  if (link.scope === 'ENTIRE_ROOM') {
    return true;
  }

  if (link.scope === 'DOCUMENT') {
    return link.scopedDocumentId === document.id;
  }

  if (link.scope !== 'FOLDER' || !link.scopedFolderId || !document.folderId) {
    return false;
  }

  let folderId: string | null = document.folderId;
  const visited = new Set<string>();

  while (folderId && !visited.has(folderId)) {
    visited.add(folderId);
    const folder: { parentId: string | null } | null = await tx.folder.findFirst({
      where: { id: folderId, roomId },
      select: { parentId: true },
    });
    if (!folder) {
      return false;
    }

    if (folderId === link.scopedFolderId) {
      return true;
    }

    folderId = folder.parentId;
  }

  return false;
}
