import type { Prisma } from '@prisma/client';

import type { StarterFolderDefinition } from './starterFolderTemplates';

function depth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function parentPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : null;
}

/** Creates a selected template tree atomically, preserving parent references and sibling ordering. */
export async function createStarterFolderTree(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; roomId: string; folders: StarterFolderDefinition[] }
): Promise<number> {
  if (input.folders.length === 0) {
    return 0;
  }

  const byDepth = new Map<number, StarterFolderDefinition[]>();
  for (const folder of input.folders) {
    const level = byDepth.get(depth(folder.path)) ?? [];
    level.push(folder);
    byDepth.set(depth(folder.path), level);
  }

  const folderIdByPath = new Map<string, string>();
  for (const levelDepth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const level = byDepth.get(levelDepth)!;
    const siblingOrder = new Map<string | null, number>();
    await tx.folder.createMany({
      data: level.map((folder) => {
        const parent = parentPath(folder.path);
        const displayOrder = siblingOrder.get(parent) ?? 0;
        siblingOrder.set(parent, displayOrder + 1);
        return {
          organizationId: input.organizationId,
          roomId: input.roomId,
          name: folder.name,
          path: folder.path,
          parentId: parent ? (folderIdByPath.get(parent) ?? null) : null,
          displayOrder,
        };
      }),
    });
    const created = await tx.folder.findMany({
      where: {
        organizationId: input.organizationId,
        roomId: input.roomId,
        path: { in: level.map((f) => f.path) },
      },
      select: { id: true, path: true },
    });
    for (const folder of created) {
      folderIdByPath.set(folder.path, folder.id);
    }
  }

  return input.folders.length;
}
