/**
 * Per-room and global localStorage keys for room navigation preferences.
 *
 * Authoritative source: docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md
 *
 * Per-room scope avoids preference bleed between unrelated rooms (a user's
 * choice in a folder-heavy diligence room must not govern a flat marketing
 * room). Mobile drawer state is intentionally not persisted.
 */

export const ROOM_VIEW_MODE_VALUES = ['grid', 'list'] as const;
export type RoomViewMode = (typeof ROOM_VIEW_MODE_VALUES)[number];

export const ROOM_LIST_MODE_HINT_DISMISSED_KEY = 'vaultspace:room:listModeHintDismissed';

export function roomViewModeKey(roomId: string): string {
  return `vaultspace:room:${roomId}:viewMode`;
}

export function roomFolderPaneOpenKey(roomId: string): string {
  return `vaultspace:room:${roomId}:folderPaneOpen`;
}

export function isRoomViewMode(value: unknown): value is RoomViewMode {
  return value === 'grid' || value === 'list';
}
