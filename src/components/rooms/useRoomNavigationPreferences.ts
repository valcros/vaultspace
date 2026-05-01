'use client';

import * as React from 'react';

import {
  ROOM_LIST_MODE_HINT_DISMISSED_KEY,
  RoomViewMode,
  isRoomViewMode,
  roomFolderPaneOpenKey,
  roomViewModeKey,
} from '@/lib/rooms/navigationPreferenceKeys';

interface UseRoomNavigationPreferencesArgs {
  roomId: string;
  /**
   * Default for the desktop folder pane the first time a room is visited in
   * list mode. Spec: pane open by default at lg+.
   */
  defaultPaneOpen?: boolean;
}

interface RoomNavigationPreferences {
  viewMode: RoomViewMode;
  setViewMode: (mode: RoomViewMode) => void;
  folderPaneOpen: boolean;
  setFolderPaneOpen: (open: boolean) => void;
  toggleFolderPane: () => void;
  listModeHintDismissed: boolean;
  dismissListModeHint: () => void;
}

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageString(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / privacy errors */
  }
}

/**
 * Per-room navigation preferences backed by localStorage.
 *
 * - viewMode persists per-room
 * - folderPaneOpen persists per-room (desktop only; the room page is
 *   responsible for ignoring this state below the lg breakpoint)
 * - listModeHintDismissed is a single global flag once the user has seen the
 *   one-time tooltip in any room
 *
 * First visit always defaults to grid (per the v3 contract).
 */
export function useRoomNavigationPreferences({
  roomId,
  defaultPaneOpen = true,
}: UseRoomNavigationPreferencesArgs): RoomNavigationPreferences {
  const viewModeStorageKey = React.useMemo(() => roomViewModeKey(roomId), [roomId]);
  const paneOpenStorageKey = React.useMemo(() => roomFolderPaneOpenKey(roomId), [roomId]);

  const [viewMode, setViewModeState] = React.useState<RoomViewMode>('grid');
  const [folderPaneOpen, setFolderPaneOpenState] = React.useState<boolean>(defaultPaneOpen);
  const [listModeHintDismissed, setListModeHintDismissed] = React.useState<boolean>(true);

  // Hydrate from localStorage after mount so SSR and the first client render
  // agree on the default (grid, pane open, hint hidden) and avoid hydration
  // warnings.
  React.useEffect(() => {
    const storedMode = readLocalStorageString(viewModeStorageKey);
    if (isRoomViewMode(storedMode)) {
      setViewModeState(storedMode);
    } else {
      setViewModeState('grid');
    }

    const storedPaneOpen = readLocalStorageString(paneOpenStorageKey);
    if (storedPaneOpen === 'true') {
      setFolderPaneOpenState(true);
    } else if (storedPaneOpen === 'false') {
      setFolderPaneOpenState(false);
    } else {
      setFolderPaneOpenState(defaultPaneOpen);
    }

    const dismissed = readLocalStorageString(ROOM_LIST_MODE_HINT_DISMISSED_KEY);
    setListModeHintDismissed(dismissed === 'true');
  }, [viewModeStorageKey, paneOpenStorageKey, defaultPaneOpen]);

  const setViewMode = React.useCallback(
    (mode: RoomViewMode) => {
      setViewModeState(mode);
      writeLocalStorageString(viewModeStorageKey, mode);
    },
    [viewModeStorageKey]
  );

  const setFolderPaneOpen = React.useCallback(
    (open: boolean) => {
      setFolderPaneOpenState(open);
      writeLocalStorageString(paneOpenStorageKey, open ? 'true' : 'false');
    },
    [paneOpenStorageKey]
  );

  const toggleFolderPane = React.useCallback(() => {
    setFolderPaneOpenState((prev) => {
      const next = !prev;
      writeLocalStorageString(paneOpenStorageKey, next ? 'true' : 'false');
      return next;
    });
  }, [paneOpenStorageKey]);

  const dismissListModeHint = React.useCallback(() => {
    setListModeHintDismissed(true);
    writeLocalStorageString(ROOM_LIST_MODE_HINT_DISMISSED_KEY, 'true');
  }, []);

  return {
    viewMode,
    setViewMode,
    folderPaneOpen,
    setFolderPaneOpen,
    toggleFolderPane,
    listModeHintDismissed,
    dismissListModeHint,
  };
}
