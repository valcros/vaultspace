import { MAX_FOLDER_DEPTH } from './folderDepth';
import type { StarterFolderDefinition } from './starterFolderTemplates';

export const MAX_INITIAL_ROOM_FOLDERS = 100;

export interface AdditionalRoomFolder {
  name: string;
  parentPath: string | null;
}

type Result = { ok: true; folders: StarterFolderDefinition[] } | { ok: false; error: string };

function depth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/** Resolve room-only additions against the selected template before any write. */
export function resolveAdditionalRoomFolders(
  templateFolders: StarterFolderDefinition[],
  additions: AdditionalRoomFolder[]
): Result {
  if (templateFolders.length + additions.length > MAX_INITIAL_ROOM_FOLDERS) {
    return {
      ok: false,
      error: `A room can start with at most ${MAX_INITIAL_ROOM_FOLDERS} folders`,
    };
  }

  const folders = [...templateFolders];
  const paths = new Set(templateFolders.map((folder) => folder.path.toLowerCase()));
  const siblings = new Set<string>();
  for (const folder of templateFolders) {
    const parent = folder.path.slice(0, folder.path.lastIndexOf('/')) || '';
    siblings.add(`${parent.toLowerCase()}\0${folder.name.toLowerCase()}`);
  }

  for (const addition of additions) {
    const name = addition.name.trim();
    const parent = addition.parentPath;
    if (
      !name ||
      name.length > 255 ||
      name === '.' ||
      name === '..' ||
      /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)
    ) {
      return { ok: false, error: 'Custom folder name is invalid' };
    }
    if (parent !== null && !folders.some((folder) => folder.path === parent)) {
      return { ok: false, error: `Parent folder for "${name}" is not selected` };
    }
    if (parent !== null && depth(parent) >= MAX_FOLDER_DEPTH) {
      return { ok: false, error: `Custom folders cannot exceed ${MAX_FOLDER_DEPTH} levels` };
    }
    const path = `${parent ?? ''}/${name}`;
    if (path.length > 1000) {
      return { ok: false, error: 'Custom folder path is too long' };
    }
    const siblingKey = `${(parent ?? '').toLowerCase()}\0${name.toLowerCase()}`;
    if (siblings.has(siblingKey) || paths.has(path.toLowerCase())) {
      return { ok: false, error: `A folder named "${name}" already exists at this level` };
    }
    folders.push({ name, path });
    paths.add(path.toLowerCase());
    siblings.add(siblingKey);
  }

  return { ok: true, folders };
}
