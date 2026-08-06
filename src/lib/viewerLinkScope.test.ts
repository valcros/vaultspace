import { describe, expect, it, vi } from 'vitest';
import type { LinkScope, Prisma } from '@prisma/client';

import { canViewerLinkAccessDocument } from './viewerLinkScope';

function makeTx(parents: Record<string, string | null>) {
  const findFirst = vi.fn(async ({ where }: { where: { id: string; roomId: string } }) => {
    if (where.roomId !== 'room-1' || !(where.id in parents)) {
      return null;
    }
    return { parentId: parents[where.id] ?? null };
  });
  return {
    tx: { folder: { findFirst } } as unknown as Prisma.TransactionClient,
    findFirst,
  };
}

function link(
  scope: LinkScope,
  overrides: Partial<{ scopedFolderId: string | null; scopedDocumentId: string | null }> = {}
) {
  return {
    scope,
    scopedFolderId: null,
    scopedDocumentId: null,
    ...overrides,
  };
}

describe('canViewerLinkAccessDocument', () => {
  it('allows any document already resolved inside an entire-room link room', async () => {
    const { tx, findFirst } = makeTx({});

    await expect(
      canViewerLinkAccessDocument(tx, link('ENTIRE_ROOM'), 'room-1', {
        id: 'doc-1',
        folderId: null,
      })
    ).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows only the exact document for a document-scoped link', async () => {
    const { tx, findFirst } = makeTx({});
    const documentLink = link('DOCUMENT', { scopedDocumentId: 'doc-1' });

    await expect(
      canViewerLinkAccessDocument(tx, documentLink, 'room-1', {
        id: 'doc-1',
        folderId: null,
      })
    ).resolves.toBe(true);
    await expect(
      canViewerLinkAccessDocument(tx, documentLink, 'room-1', {
        id: 'doc-2',
        folderId: null,
      })
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows documents in the scoped folder and its descendants', async () => {
    const { tx } = makeTx({ 'scope-root': null, child: 'scope-root', grandchild: 'child' });
    const folderLink = link('FOLDER', { scopedFolderId: 'scope-root' });

    await expect(
      canViewerLinkAccessDocument(tx, folderLink, 'room-1', {
        id: 'doc-direct',
        folderId: 'scope-root',
      })
    ).resolves.toBe(true);
    await expect(
      canViewerLinkAccessDocument(tx, folderLink, 'room-1', {
        id: 'doc-nested',
        folderId: 'grandchild',
      })
    ).resolves.toBe(true);
  });

  it('denies root documents, sibling folders, missing parents, and hierarchy cycles', async () => {
    const { tx } = makeTx({
      sibling: null,
      'missing-child': 'missing-parent',
      'cycle-a': 'cycle-b',
      'cycle-b': 'cycle-a',
    });
    const folderLink = link('FOLDER', { scopedFolderId: 'scope-root' });

    for (const folderId of [null, 'sibling', 'missing-child', 'cycle-a']) {
      await expect(
        canViewerLinkAccessDocument(tx, folderLink, 'room-1', {
          id: `doc-${folderId ?? 'root'}`,
          folderId,
        })
      ).resolves.toBe(false);
    }
  });

  it('denies a direct scoped-folder id that is not bound to the viewer room', async () => {
    const { tx } = makeTx({});

    await expect(
      canViewerLinkAccessDocument(
        tx,
        link('FOLDER', { scopedFolderId: 'foreign-folder' }),
        'room-1',
        { id: 'doc-1', folderId: 'foreign-folder' }
      )
    ).resolves.toBe(false);
  });
});
