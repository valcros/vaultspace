'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { RoomFolderTreeNode } from '@/components/rooms/RoomFolderTree';
import type { RoomViewMode } from '@/lib/rooms/navigationPreferenceKeys';

export interface Room {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  enableWatermark: boolean;
  watermarkTemplate: string | null;
  downloadEnabled: boolean;
  allDocumentsConfidential: boolean;
  createdAt: string;
}

export interface Document {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  tags: string[];
  category: string | null;
  confidential: boolean;
  uploadedBy: { firstName: string; lastName: string };
  expiresAt: string | null;
  expiryAction: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  childCount: number;
  documentCount: number;
  createdAt: string;
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface UseRoomContentsOptions {
  /** Desktop folder rail open state; the tree must load when it is shown. */
  folderPaneOpen: boolean;
  roomId: string;
  /** Active category filter; documents refetch when it changes. */
  categoryFilter: string | null;
  /** Current view mode; gates the deferred folder-tree fetch. */
  viewMode: RoomViewMode;
  /** Whether the one-time list-mode hint has been dismissed. */
  listModeHintDismissed: boolean;
}

/**
 * Owns the room-content data plane for the room detail page: the room record,
 * the current folder's documents and subfolders, breadcrumb trail, the
 * whole-room folder tree (deferred), and bookmarks — plus the navigation
 * actions that mutate them. Pure UI state (dialogs, selection, sort, density)
 * stays on the page.
 */
export function useRoomContents({
  roomId,
  categoryFilter,
  viewMode,
  listModeHintDismissed,
  folderPaneOpen,
}: UseRoomContentsOptions) {
  const router = useRouter();

  const [room, setRoom] = React.useState<Room | null>(null);
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [folders, setFolders] = React.useState<FolderItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = React.useState<BreadcrumbItem[]>([
    { id: null, name: 'Root' },
  ]);
  const [isLoading, setIsLoading] = React.useState(true);
  // Tracks whether documents AND folders have finished their initial fetch.
  // Without this, the room renders for a tick with empty arrays and the
  // empty-state branch flashes "No documents yet" before the data arrives.
  const [contentLoaded, setContentLoaded] = React.useState(false);
  const [folderTree, setFolderTree] = React.useState<RoomFolderTreeNode[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(new Set());
  const [folderDrawerOpen, setFolderDrawerOpen] = React.useState(false);

  // Bookmarks
  const [bookmarkedDocs, setBookmarkedDocs] = React.useState<Set<string>>(new Set());

  const fetchRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (response.ok) {
        const data = await response.json();
        setRoom(data.room);
      } else if (response.status === 404) {
        router.push('/rooms');
      }
    } catch (error) {
      console.error('Failed to fetch room:', error);
    } finally {
      setIsLoading(false);
    }
  }, [roomId, router]);

  const fetchDocuments = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (currentFolderId) {
        params.set('folderId', currentFolderId);
      }
      if (categoryFilter) {
        params.set('category', categoryFilter);
      }
      const url = `/api/rooms/${roomId}/documents${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  }, [roomId, currentFolderId, categoryFilter]);

  const fetchFolders = React.useCallback(async () => {
    try {
      const url = currentFolderId
        ? `/api/rooms/${roomId}/folders?parentId=${currentFolderId}`
        : `/api/rooms/${roomId}/folders`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    }
  }, [roomId, currentFolderId]);

  const fetchFolderTree = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/folders?tree=1`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const nodes: RoomFolderTreeNode[] = (data.folders || []).map(
        (f: {
          id: string;
          name: string;
          parentId: string | null;
          path: string;
          depth?: number;
          childCount?: number;
        }) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          path: f.path,
          depth: f.depth ?? f.path.split('/').filter(Boolean).length,
          childCount: f.childCount ?? 0,
        })
      );
      setFolderTree(nodes);
    } catch (error) {
      console.error('Failed to fetch folder tree:', error);
    }
  }, [roomId]);

  // The whole-room folder tree is needed by the folder rail (either view,
  // when open), the mobile folder drawer, list mode's rail default, and
  // (once) the grid-mode discoverability hint. Returning grid-mode users
  // with the rail collapsed and the hint dismissed skip the fetch.
  const needsFolderTree =
    viewMode === 'list' || folderPaneOpen || folderDrawerOpen || !listModeHintDismissed;
  React.useEffect(() => {
    if (needsFolderTree) {
      fetchFolderTree();
    }
  }, [needsFolderTree, fetchFolderTree]);

  const folderById = React.useMemo(() => {
    const map = new Map<string, RoomFolderTreeNode>();
    for (const f of folderTree) {
      map.set(f.id, f);
    }
    return map;
  }, [folderTree]);

  // Auto-expand ancestors of the currently selected folder so the tree always
  // reveals the active branch.
  React.useEffect(() => {
    if (!currentFolderId) {
      return;
    }
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      let cursor: string | null | undefined = currentFolderId;
      while (cursor) {
        const node: RoomFolderTreeNode | undefined = folderById.get(cursor);
        if (!node || !node.parentId) {
          break;
        }
        next.add(node.parentId);
        cursor = node.parentId;
      }
      return next;
    });
  }, [currentFolderId, folderById]);

  const handleTreeSelect = React.useCallback(
    (folderId: string | null) => {
      if (folderId === null) {
        setCurrentFolderId(null);
        setBreadcrumbs([{ id: null, name: 'Root' }]);
        setFolderDrawerOpen(false);
        return;
      }
      const node = folderById.get(folderId);
      if (!node) {
        return;
      }
      const trail: BreadcrumbItem[] = [{ id: null, name: 'Root' }];
      const segments = node.path.split('/').filter(Boolean);
      let pathSoFar = '';
      for (const segment of segments) {
        pathSoFar = `${pathSoFar}/${segment}`;
        const match = folderTree.find((f) => f.path === pathSoFar);
        if (match) {
          trail.push({ id: match.id, name: match.name });
        }
      }
      setCurrentFolderId(folderId);
      setBreadcrumbs(trail);
      setFolderDrawerOpen(false);
    },
    [folderById, folderTree]
  );

  const handleToggleExpand = React.useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // Determine whether the folder-heavy hint is worth showing on this room.
  // Spec threshold: at room root with >=4 root folders, or any root folder
  // with childCount > 0.
  const listModeHintEligible = React.useMemo(() => {
    if (currentFolderId !== null) {
      return false;
    }
    const roots = folderTree.filter((f) => f.parentId === null);
    if (roots.length >= 4) {
      return true;
    }
    return roots.some((f) => f.childCount > 0);
  }, [folderTree, currentFolderId]);

  const showListModeHint = viewMode === 'grid' && listModeHintEligible && !listModeHintDismissed;

  const fetchBookmarks = React.useCallback(async () => {
    try {
      const response = await fetch('/api/bookmarks');
      if (response.ok) {
        const data = await response.json();
        const ids = new Set<string>(
          (data.bookmarks || []).map((b: { documentId: string }) => b.documentId)
        );
        setBookmarkedDocs(ids);
      }
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error);
    }
  }, []);

  const toggleBookmark = React.useCallback(
    async (doc: Document) => {
      const isBookmarked = bookmarkedDocs.has(doc.id);
      // Optimistic update
      setBookmarkedDocs((prev) => {
        const next = new Set(prev);
        if (isBookmarked) {
          next.delete(doc.id);
        } else {
          next.add(doc.id);
        }
        return next;
      });
      try {
        if (isBookmarked) {
          await fetch('/api/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: doc.id }),
          });
        } else {
          await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: doc.id, roomId }),
          });
        }
      } catch (error) {
        console.error('Failed to toggle bookmark:', error);
        // Revert on failure
        setBookmarkedDocs((prev) => {
          const next = new Set(prev);
          if (isBookmarked) {
            next.add(doc.id);
          } else {
            next.delete(doc.id);
          }
          return next;
        });
      }
    },
    [bookmarkedDocs, roomId]
  );

  React.useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // Documents are the always-on page body. One effect covers both the initial
  // load and folder navigation: fetchDocuments/fetchFolders are recreated when
  // currentFolderId changes, so this fires exactly once per (room, folder)
  // transition — previously two overlapping effects double-fetched on every
  // room open. contentLoaded flips after the first resolution so the
  // empty-state branch cannot flash on initial render.
  React.useEffect(() => {
    if (!room) {
      return;
    }
    let cancelled = false;
    Promise.all([fetchDocuments(), fetchFolders()]).finally(() => {
      if (!cancelled) {
        setContentLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [room, fetchDocuments, fetchFolders]);

  // Bookmarks are folder-independent; fetch once per room.
  React.useEffect(() => {
    if (room) {
      fetchBookmarks();
    }
  }, [room, fetchBookmarks]);

  // Navigate into a folder
  const handleFolderClick = React.useCallback((folder: FolderItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }, []);

  // Navigate via breadcrumb
  const handleBreadcrumbClick = React.useCallback(
    (index: number) => {
      const item = breadcrumbs[index];
      if (item) {
        setCurrentFolderId(item.id);
        setBreadcrumbs((prev) => prev.slice(0, index + 1));
      }
    },
    [breadcrumbs]
  );

  return {
    room,
    documents,
    folders,
    currentFolderId,
    breadcrumbs,
    isLoading,
    contentLoaded,
    folderTree,
    expandedFolderIds,
    folderDrawerOpen,
    setFolderDrawerOpen,
    bookmarkedDocs,
    showListModeHint,
    fetchDocuments,
    fetchFolders,
    fetchFolderTree,
    toggleBookmark,
    handleTreeSelect,
    handleToggleExpand,
    handleFolderClick,
    handleBreadcrumbClick,
  };
}
