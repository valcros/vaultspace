/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useRoomNavigationPreferences } from './useRoomNavigationPreferences';
import {
  ROOM_LIST_MODE_HINT_DISMISSED_KEY,
  roomFolderPaneOpenKey,
  roomViewModeKey,
} from '@/lib/rooms/navigationPreferenceKeys';

describe('useRoomNavigationPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to grid mode and pane open on first visit', () => {
    const { result } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-A' }));
    expect(result.current.viewMode).toBe('grid');
    expect(result.current.folderPaneOpen).toBe(true);
    expect(result.current.listModeHintDismissed).toBe(false);
  });

  it('persists viewMode per-room', () => {
    const { result } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-A' }));
    act(() => result.current.setViewMode('list'));
    expect(window.localStorage.getItem(roomViewModeKey('room-A'))).toBe('list');
    expect(window.localStorage.getItem(roomViewModeKey('room-B'))).toBeNull();
  });

  it('persists folderPaneOpen per-room', () => {
    const { result } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-A' }));
    act(() => result.current.setFolderPaneOpen(false));
    expect(window.localStorage.getItem(roomFolderPaneOpenKey('room-A'))).toBe('false');
  });

  it('does not bleed preferences across rooms', () => {
    window.localStorage.setItem(roomViewModeKey('room-A'), 'list');

    const { result: roomB } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-B' }));
    expect(roomB.current.viewMode).toBe('grid');
  });

  it('dismisses the list-mode hint globally', () => {
    const { result } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-A' }));
    act(() => result.current.dismissListModeHint());
    expect(result.current.listModeHintDismissed).toBe(true);
    expect(window.localStorage.getItem(ROOM_LIST_MODE_HINT_DISMISSED_KEY)).toBe('true');
  });

  it('toggleFolderPane flips and persists', () => {
    const { result } = renderHook(() => useRoomNavigationPreferences({ roomId: 'room-A' }));
    act(() => result.current.toggleFolderPane());
    expect(result.current.folderPaneOpen).toBe(false);
    expect(window.localStorage.getItem(roomFolderPaneOpenKey('room-A'))).toBe('false');
  });
});
