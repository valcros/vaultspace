'use client';

import * as React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  FileText,
  Settings,
  Upload,
  FolderPlus,
  Folder,
  MoreHorizontal,
  Download,
  Eye,
  Trash2,
  Copy,
  BarChart3,
  History,
  ChevronRight,
  List,
  LayoutGrid,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Columns3,
  Minus,
  Lock,
  Tag,
  Square,
  CheckSquare,
  Star,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { AdminEmptyState, AdminSurface } from '@/components/layout/admin-page';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from '@/components/ui/sheet';
import dynamic from 'next/dynamic';
import { RoomFolderTree, RoomFolderTreeNode } from '@/components/rooms/RoomFolderTree';
import { useRoomNavigationPreferences } from '@/components/rooms/useRoomNavigationPreferences';
import { PanelLeftClose, PanelLeftOpen, PanelLeft, Info } from 'lucide-react';

// The upload surface only renders on user action; keep it out of the
// initial room chunk.
const paneLoading = () => (
  <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">Loading…</div>
);
const UploadZone = dynamic(
  () => import('@/components/documents/UploadZone').then((m) => m.UploadZone),
  { loading: paneLoading, ssr: false }
);
// The preview dialog only mounts on user action (row click / ?doc= deep
// link); load it lazily client-side so it stays out of the initial chunk.
const PreviewDialog = dynamic(
  () => import('./_components/PreviewDialog').then((m) => m.PreviewDialog),
  { loading: () => null, ssr: false }
);
const VersionHistoryDialog = dynamic(
  () => import('./_components/VersionHistoryDialog').then((m) => m.VersionHistoryDialog),
  { loading: () => null, ssr: false }
);
import { FileTypeIcon } from '@/components/documents/FileTypeIcon';
import { toast } from '@/components/ui/use-toast';
import { CATEGORY_OPTIONS, getCategoryLabel, getCategoryColor } from '@/lib/documentCategories';
import { CreateFolderDialog } from './_components/CreateFolderDialog';
import { DeleteDocumentDialog } from './_components/DeleteDocumentDialog';
import { DeleteFolderDialog } from './_components/DeleteFolderDialog';
import { EditPropertiesDialog } from './_components/EditPropertiesDialog';
import { ManageDrawer, isManagePane, type ManagePane } from './_components/ManageDrawer';

interface Room {
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

interface Document {
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

interface FolderItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  childCount: number;
  documentCount: number;
  createdAt: string;
}

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = params['roomId'] as string;

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
  // Drawer-internal pane state. Documents are the page body now, not a tab,
  // so this only chooses which secondary surface (Access / Share Links /
  // Q&A / Checklist / Calendar) is visible inside the Manage Room drawer.
  const [managePane, setManagePane] = React.useState<ManagePane>(() => {
    const requested = searchParams.get('manage');
    return isManagePane(requested) ? requested : 'members';
  });
  const {
    viewMode,
    setViewMode,
    folderPaneOpen,
    setFolderPaneOpen,
    toggleFolderPane,
    listModeHintDismissed,
    dismissListModeHint,
  } = useRoomNavigationPreferences({ roomId });
  const [folderTree, setFolderTree] = React.useState<RoomFolderTreeNode[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(new Set());
  const [folderDrawerOpen, setFolderDrawerOpen] = React.useState(false);
  const folderDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);

  const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null);
  const [compact, setCompact] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vaultspace-compact') === 'true';
    }
    return false;
  });
  const [sortField, setSortField] = React.useState<'name' | 'size' | 'createdAt'>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = React.useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('vaultspace-columns');
      if (stored) {
        return JSON.parse(stored);
      }
    }
    return { name: true, size: true, uploaded: true };
  });

  // Bulk selection
  const [selectedDocs, setSelectedDocs] = React.useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    doc: Document;
  } | null>(null);

  // Bookmarks
  const [bookmarkedDocs, setBookmarkedDocs] = React.useState<Set<string>>(new Set());

  // Dialog states
  const [showUploadDialog, setShowUploadDialog] = React.useState(false);
  const [showFolderDialog, setShowFolderDialog] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = React.useState(false);
  const [selectedDocument, setSelectedDocument] = React.useState<Document | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // Version history states
  const [showVersionDialog, setShowVersionDialog] = React.useState(false);
  const [versionDoc, setVersionDoc] = React.useState<Document | null>(null);

  // Folder delete states
  const [showFolderDeleteDialog, setShowFolderDeleteDialog] = React.useState(false);
  const [selectedFolder, setSelectedFolder] = React.useState<FolderItem | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = React.useState(false);

  // Tag editor states
  const [editingTagsDoc, setEditingTagsDoc] = React.useState<Document | null>(null);

  // Manage drawer (Access / Share Links / Q&A / Checklist / Calendar) open
  // state. Closed by default so the room canvas leads with documents, unless
  // a ?manage=<pane> deep link (e.g. from landing attention chips) requests one.
  const [manageOpen, setManageOpen] = React.useState(() =>
    isManagePane(searchParams.get('manage'))
  );

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

  const sortedDocuments = React.useMemo(() => {
    return [...documents].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'size') {
        cmp = a.size - b.size;
      } else if (sortField === 'createdAt') {
        cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [documents, sortField, sortDir]);

  const handleSort = React.useCallback(
    (field: 'name' | 'size' | 'createdAt') => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  const toggleDocSelection = React.useCallback((docId: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = React.useCallback(() => {
    if (selectedDocs.size === documents.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(documents.map((d) => d.id)));
    }
  }, [documents, selectedDocs.size]);

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

  const handleBulkCategory = React.useCallback(
    async (category: string | null) => {
      for (const docId of Array.from(selectedDocs)) {
        await fetch(`/api/rooms/${roomId}/documents/${docId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
      }
      setSelectedDocs(new Set());
      fetchDocuments();
    },
    [selectedDocs, roomId, fetchDocuments]
  );

  const handleBulkConfidential = React.useCallback(
    async (confidential: boolean) => {
      for (const docId of Array.from(selectedDocs)) {
        await fetch(`/api/rooms/${roomId}/documents/${docId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confidential }),
        });
      }
      setSelectedDocs(new Set());
      fetchDocuments();
    },
    [selectedDocs, roomId, fetchDocuments]
  );

  const handleBulkDelete = React.useCallback(async () => {
    for (const docId of Array.from(selectedDocs)) {
      await fetch(`/api/rooms/${roomId}/documents/${docId}`, { method: 'DELETE' });
    }
    setSelectedDocs(new Set());
    fetchDocuments();
  }, [selectedDocs, roomId, fetchDocuments]);

  const handleSaveTags = React.useCallback(
    async (doc: Document, tags: string[]) => {
      try {
        await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags }),
        });
        fetchDocuments();
        setEditingTagsDoc(null);
      } catch (error) {
        console.error('Failed to save tags:', error);
      }
    },
    [roomId, fetchDocuments]
  );

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

  // The whole-room folder tree is only needed by the list-mode rail, the
  // mobile folder drawer, and (once) the grid-mode discoverability hint.
  // Returning grid-mode users who dismissed the hint skip the fetch entirely
  // instead of paying for the full hierarchy on every room open.
  const needsFolderTree = viewMode === 'list' || folderDrawerOpen || !listModeHintDismissed;
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Handle upload completion - refresh document list
  const handleUploadComplete = React.useCallback(
    (_results: Array<{ documentId: string; name: string }>) => {
      setShowUploadDialog(false);
      fetchDocuments();
    },
    [fetchDocuments]
  );

  // Handle folder creation
  const handleCreateFolder = React.useCallback(
    async (name: string) => {
      if (!name.trim()) {
        return false;
      }

      setIsCreatingFolder(true);
      try {
        const response = await fetch(`/api/rooms/${roomId}/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            parentId: currentFolderId,
          }),
        });

        if (response.ok) {
          setShowFolderDialog(false);
          fetchFolders(); // Refresh current folder listing
          fetchFolderTree(); // Keep the split-pane rail in sync
          return true;
        } else {
          const error = await response.json();
          console.error('Failed to create folder:', error);
          toast({
            title: 'Error',
            description: error.error?.message || 'Failed to create folder',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Failed to create folder:', error);
        toast({ title: 'Error', description: 'Failed to create folder', variant: 'destructive' });
      } finally {
        setIsCreatingFolder(false);
      }
      return false;
    },
    [roomId, currentFolderId, fetchFolders, fetchFolderTree]
  );

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

  // Handle document download
  const handleDownload = React.useCallback(
    async (doc: Document) => {
      try {
        const response = await fetch(`/api/rooms/${roomId}/documents/${doc.id}/download`);
        if (!response.ok) {
          throw new Error('Download failed');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (error) {
        console.error('Download error:', error);
        toast({
          title: 'Error',
          description: 'Failed to download document',
          variant: 'destructive',
        });
      }
    },
    [roomId]
  );

  // Handle document preview. PreviewDialog derives the preview URL (or the
  // not-previewable error) from the document itself; the page only tracks
  // which document is open.
  const handlePreview = React.useCallback((doc: Document) => {
    setSelectedDocument(doc);
    setShowPreviewDialog(true);
  }, []);

  // ?doc=<id> deep links (landing "Continue reading" / bookmarks) open the
  // preview directly. Fetched by id because the document may live in a folder
  // other than the one currently listed.
  const requestedDocId = searchParams.get('doc');
  const docDeepLinkHandled = React.useRef(false);
  React.useEffect(() => {
    if (!requestedDocId || docDeepLinkHandled.current || isLoading) {
      return;
    }
    docDeepLinkHandled.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/documents/${requestedDocId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.document?.id) {
            handlePreview(data.document);
          }
        }
      } catch {
        // Deep link is best-effort; the room itself has already rendered.
      }
    })();
  }, [requestedDocId, isLoading, roomId, handlePreview]);

  // Handle version history. VersionHistoryDialog fetches the versions and
  // owns rollback / upload-new-version; the page only tracks which document
  // is open.
  const handleShowVersions = React.useCallback((doc: Document) => {
    setVersionDoc(doc);
    setShowVersionDialog(true);
  }, []);

  // Handle document delete
  const handleDelete = React.useCallback(async (doc: Document) => {
    setSelectedDocument(doc);
    setShowDeleteDialog(true);
  }, []);

  // Confirm delete
  const confirmDelete = React.useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/documents/${selectedDocument.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setShowDeleteDialog(false);
        setSelectedDocument(null);
        fetchDocuments(); // Refresh the list
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to delete document',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: 'Error', description: 'Failed to delete document', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  }, [roomId, selectedDocument, fetchDocuments]);

  // Handle folder delete
  const handleFolderDelete = React.useCallback((folder: FolderItem) => {
    setSelectedFolder(folder);
    setShowFolderDeleteDialog(true);
  }, []);

  // Confirm folder delete
  const confirmFolderDelete = React.useCallback(async () => {
    if (!selectedFolder) {
      return;
    }

    setIsDeletingFolder(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/folders/${selectedFolder.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setShowFolderDeleteDialog(false);
        setSelectedFolder(null);
        fetchFolders();
        fetchFolderTree();
        fetchDocuments(); // Documents may have been deleted too
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to delete folder',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Folder delete error:', error);
      toast({ title: 'Error', description: 'Failed to delete folder', variant: 'destructive' });
    } finally {
      setIsDeletingFolder(false);
    }
  }, [roomId, selectedFolder, fetchFolders, fetchDocuments, fetchFolderTree]);

  const handleDuplicateRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/duplicate`, { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        toast({ title: 'Room duplicated', description: `Created "${data.room.name}"` });
        router.push(`/rooms/${data.room.id}`);
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to duplicate room',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Duplicate room error:', error);
      toast({ title: 'Error', description: 'Failed to duplicate room', variant: 'destructive' });
    }
  }, [roomId, router]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!room) {
    return null;
  }

  return (
    <>
      {/*
        Room identity plane.

        Wraps the page header, the folder breadcrumb, and the document toolbar
        in a single tinted surface so the user sees one composed "orientation
        and command" zone rather than three pale-on-pale rows. The accent
        system across the whole room is intentionally constrained to one
        family (primary blue) — the surface tint here, the active states on
        the view toggle and breadcrumb endpoint, and the active section in
        the Manage drawer all share the same primary palette so the page
        reads as a single product rather than a stack of widgets.

        The plane is intentionally soft (a flat low tint against the white
        document surfaces) so it provides identity without becoming a hero band.
      */}
      <div className="mb-5 rounded-xl border border-primary-100 bg-primary-50/40 p-4 shadow-sm dark:border-primary-800/60 dark:bg-primary-950/30 lg:p-5">
        <PageHeader
          variant="work"
          className="mb-3"
          title={room.name}
          description={room.description || 'No description'}
          breadcrumbs={[{ label: 'Rooms', href: '/rooms' }, { label: room.name }]}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {room.status === 'ARCHIVED' && <Badge variant="secondary">Archived</Badge>}
              <Button
                variant="outline"
                size="sm"
                aria-label="Manage room"
                onClick={() => setManageOpen(true)}
              >
                <Settings className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Manage</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="More room actions">
                    <MoreHorizontal className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">More</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/settings`)}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/analytics`)}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Analytics
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/audit`)}>
                    <History className="mr-2 h-4 w-4" />
                    Audit Trail
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/trash`)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Trash
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDuplicateRoom}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate Room
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        {/* Folder breadcrumb. The current folder uses a primary chip so the
            user sees "where am I" at a glance without relying on gray-tone
            differences. Earlier links stay neutral. */}
        {breadcrumbs.length > 1 && (
          <nav aria-label="Folder path" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.id ?? 'root'}>
                {index > 0 && (
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 text-slate-400 dark:text-slate-500"
                  />
                )}
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                  className={
                    index === breadcrumbs.length - 1
                      ? 'rounded-md bg-primary-50 px-2.5 py-1 font-medium text-primary-800 ring-1 ring-inset ring-primary-200 dark:bg-primary-900/30 dark:text-primary-100 dark:ring-primary-800'
                      : 'rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

        {/* Composed toolbar. The whole row sits in a single white card
            inset from the tinted plane so it reads as a deliberate command
            surface, not a row of detached widgets. Primary cluster (Upload,
            New Folder) keeps full button weight; secondary cluster
            (Category, Sort) follows a thin separator and uses subtler
            chrome; right-side utilities (density / columns / view-mode)
            are visually quieter still. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-md ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:ring-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'list' && (
              <>
                {/* Mobile/tablet: open folder tree as a drawer. */}
                <Button
                  ref={folderDrawerTriggerRef}
                  size="sm"
                  variant="outline"
                  className="lg:hidden"
                  onClick={() => setFolderDrawerOpen(true)}
                  aria-label="Open folder tree"
                >
                  <PanelLeft className="h-4 w-4" />
                  <span className="ml-2">Folders</span>
                </Button>
                {/* Desktop: collapse / reopen the persistent folder pane. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="hidden lg:inline-flex"
                  onClick={toggleFolderPane}
                  aria-pressed={folderPaneOpen}
                  aria-label={folderPaneOpen ? 'Collapse folder pane' : 'Expand folder pane'}
                  title={folderPaneOpen ? 'Collapse folder pane' : 'Expand folder pane'}
                >
                  {folderPaneOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setShowUploadDialog(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowFolderDialog(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            {/* Visual separator between primary actions and secondary
                browsing utilities. Hidden on mobile where the selects are
                also hidden. */}
            <div
              aria-hidden="true"
              className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block"
            />
            {/* SelectTrigger ships with `w-full` baked in, so the trigger
                    fills its parent. Wrap each select in a fixed-width
                    flex-none div so the row doesn't expand them and they sit
                    inline with Upload / New Folder. Hidden on mobile to keep
                    the primary action row to a single line. */}
            <div className="hidden w-[170px] sm:block">
              <Select
                value={categoryFilter ?? 'all'}
                onValueChange={(v) => setCategoryFilter(v === 'all' ? null : v)}
              >
                <SelectTrigger
                  aria-label="Filter by category"
                  className="h-10 rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <Tag className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Global sort — works in both grid and list view so the
                    user has one mental model regardless of layout. The list
                    view's sortable column headers stay as a power-user
                    convenience but bind to the same sortField/sortDir. */}
            <div className="hidden w-[180px] sm:block">
              <Select
                value={`${sortField}:${sortDir}`}
                onValueChange={(v) => {
                  const [field, dir] = v.split(':') as [
                    'name' | 'size' | 'createdAt',
                    'asc' | 'desc',
                  ];
                  setSortField(field);
                  setSortDir(dir);
                }}
              >
                <SelectTrigger
                  aria-label="Sort documents"
                  className="h-10 rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name:asc">Name (A → Z)</SelectItem>
                  <SelectItem value="name:desc">Name (Z → A)</SelectItem>
                  <SelectItem value="createdAt:desc">Newest first</SelectItem>
                  <SelectItem value="createdAt:asc">Oldest first</SelectItem>
                  <SelectItem value="size:desc">Largest first</SelectItem>
                  <SelectItem value="size:asc">Smallest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Compact toggle (list view only; hidden on mobile — not meaningful
                at single-column widths) */}
            {viewMode === 'list' && (
              <button
                onClick={() => {
                  const next = !compact;
                  setCompact(next);
                  localStorage.setItem('vaultspace-compact', String(next));
                }}
                className={`hidden rounded-md border p-1.5 transition-colors sm:block ${compact ? 'border-primary-200 bg-primary-50 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-600'}`}
                title={compact ? 'Standard density' : 'Compact density'}
                aria-label={compact ? 'Switch to standard density' : 'Switch to compact density'}
              >
                <Minus className="h-4 w-4" />
              </button>
            )}
            {/* Column picker (list view only; hidden on mobile — columns are
                auto-hidden below sm anyway) */}
            {viewMode === 'list' && (
              <div className="hidden sm:block">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="rounded-md border border-transparent p-1.5 text-neutral-500 transition-colors hover:text-neutral-600"
                      title="Show/hide columns"
                      aria-label="Show or hide columns"
                    >
                      <Columns3 className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {[
                      { key: 'size', label: 'Size' },
                      { key: 'uploaded', label: 'Uploaded' },
                    ].map((col) => (
                      <DropdownMenuItem
                        key={col.key}
                        onClick={() => {
                          const next = {
                            ...visibleColumns,
                            [col.key]: !visibleColumns[col.key],
                          };
                          setVisibleColumns(next);
                          localStorage.setItem('vaultspace-columns', JSON.stringify(next));
                        }}
                      >
                        <span
                          className={`mr-2 inline-block h-3 w-3 rounded-sm border ${visibleColumns[col.key] ? 'border-primary-500 bg-primary-500' : 'border-neutral-300'}`}
                        />
                        {col.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {/* View toggle. Active mode uses a primary tint + ring so the
                  user can read the current view at a glance without parsing
                  gray-on-gray shade differences. */}
            <div
              role="group"
              aria-label="Document view mode"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
            >
              <button
                onClick={() => {
                  setViewMode('list');
                  dismissListModeHint();
                }}
                className={`relative rounded-md p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200 dark:bg-slate-950 dark:text-primary-200 dark:ring-primary-800'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
                aria-pressed={viewMode === 'list'}
                aria-label="List view"
                title="List view"
              >
                <List className="h-4 w-4" aria-hidden="true" />
                {showListModeHint && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-900"
                  />
                )}
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded-md p-1.5 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200 dark:bg-slate-950 dark:text-primary-200 dark:ring-primary-800'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
                aria-pressed={viewMode === 'grid'}
                aria-label="Grid view"
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        {/* end toolbar surface */}
      </div>
      {/* end Room identity plane */}

      {!contentLoaded ? (
        <AdminSurface className="p-6">
          <Skeleton className="mb-3 h-5 w-40" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </AdminSurface>
      ) : folders.length === 0 && documents.length === 0 && !categoryFilter ? (
        <AdminEmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No documents yet"
          description="Upload your first files or create folders to start structuring this room for secure review."
          action={
            <Button onClick={() => setShowUploadDialog(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          }
        />
      ) : viewMode === 'list' ? (
        <div
          className={
            folderPaneOpen ? 'lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-4' : undefined
          }
        >
          {folderPaneOpen && (
            <aside aria-label="Folder navigation" className="hidden lg:block">
              <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/60">
                <RoomFolderTree
                  folders={folderTree}
                  selectedFolderId={currentFolderId}
                  expandedFolderIds={expandedFolderIds}
                  onSelect={handleTreeSelect}
                  onToggleExpand={handleToggleExpand}
                />
              </div>
            </aside>
          )}
          <div className="min-w-0">
            <AdminSurface className="overflow-hidden p-0">
              <table className="w-full" aria-label="Room contents">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <button
                        onClick={toggleSelectAll}
                        aria-label={
                          selectedDocs.size > 0 && selectedDocs.size === documents.length
                            ? 'Deselect all'
                            : 'Select all'
                        }
                        className="flex items-center text-neutral-500 hover:text-neutral-600"
                      >
                        {selectedDocs.size > 0 && selectedDocs.size === documents.length ? (
                          <CheckSquare className="h-4 w-4 text-primary-500" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </th>
                    <th
                      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700"
                      onClick={() => handleSort('name')}
                    >
                      <span className="inline-flex items-center gap-1">
                        Name
                        {sortField === 'name' ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                        )}
                      </span>
                    </th>
                    {visibleColumns['size'] && (
                      <th
                        className="hidden cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 sm:table-cell"
                        onClick={() => handleSort('size')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Size
                          {sortField === 'size' ? (
                            sortDir === 'asc' ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )
                          ) : null}
                        </span>
                      </th>
                    )}
                    {visibleColumns['uploaded'] && (
                      <th
                        className="hidden cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 sm:table-cell"
                        onClick={() => handleSort('createdAt')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Uploaded
                          {sortField === 'createdAt' ? (
                            sortDir === 'asc' ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )
                          ) : null}
                        </span>
                      </th>
                    )}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Render folders first */}
                  {folders.map((folder) => (
                    <tr
                      key={folder.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-neutral-50"
                      onClick={() => handleFolderClick(folder)}
                    >
                      <td className="w-8 px-2" />
                      <td className={`px-3 ${compact ? 'py-1' : 'py-1.5'}`}>
                        <div className="flex items-center gap-2">
                          <Folder
                            className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-yellow-500`}
                          />
                          <span className={`font-medium ${compact ? 'text-sm' : ''}`}>
                            {folder.name}
                          </span>
                        </div>
                      </td>
                      {visibleColumns['size'] && (
                        <td
                          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                        >
                          {folder.documentCount} files, {folder.childCount} folders
                        </td>
                      )}
                      {visibleColumns['uploaded'] && (
                        <td
                          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                        >
                          {formatDate(folder.createdAt)}
                        </td>
                      )}
                      <td
                        className={`px-2 ${compact ? 'py-0.5' : 'py-1'}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Actions for folder ${folder.name}`}
                              className={`${compact ? 'h-6 w-6' : 'h-9 w-9 sm:h-7 sm:w-7'} p-0`}
                            >
                              <MoreHorizontal
                                aria-hidden="true"
                                className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleFolderClick(folder)}>
                              <Eye className="mr-2 h-4 w-4" />
                              Open
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleFolderDelete(folder)}
                              className="text-danger-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {/* Render documents */}
                  {sortedDocuments.map((doc) => (
                    <tr
                      key={doc.id}
                      className={`cursor-pointer border-b last:border-0 hover:bg-neutral-50 ${selectedDocs.has(doc.id) ? 'bg-primary-50' : ''}`}
                      onClick={() => handlePreview(doc)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, doc });
                      }}
                    >
                      <td
                        className="w-8 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDocSelection(doc.id);
                        }}
                      >
                        {selectedDocs.has(doc.id) ? (
                          <CheckSquare className="h-4 w-4 text-primary-500" />
                        ) : (
                          <Square className="h-4 w-4 text-neutral-300" />
                        )}
                      </td>
                      <td className={`px-3 ${compact ? 'py-1' : 'py-1.5'}`}>
                        <div className="flex items-center gap-2">
                          <FileTypeIcon
                            mimeType={doc.mimeType}
                            className={compact ? 'h-4 w-4' : undefined}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`truncate font-medium ${compact ? 'text-sm' : ''}`}>
                                {doc.name}
                              </span>
                              {(doc.confidential || room?.allDocumentsConfidential) && (
                                <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                              )}
                            </div>
                            {!compact && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {doc.category && (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${getCategoryColor(doc.category)}`}
                                  >
                                    {getCategoryLabel(doc.category)}
                                  </span>
                                )}
                                {doc.tags?.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className="px-1 py-0 text-[10px]"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {doc.expiresAt && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0 text-[10px] font-medium text-orange-600">
                                    <Clock className="h-2.5 w-2.5" />
                                    Expires {new Date(doc.expiresAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {visibleColumns['size'] && (
                        <td
                          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                        >
                          {formatFileSize(doc.size)}
                        </td>
                      )}
                      {visibleColumns['uploaded'] && (
                        <td
                          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                        >
                          {formatDate(doc.createdAt)}
                        </td>
                      )}
                      <td
                        className={`px-2 ${compact ? 'py-0.5' : 'py-1'}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Actions for ${doc.name}`}
                              className={`${compact ? 'h-6 w-6' : 'h-9 w-9 sm:h-7 sm:w-7'} p-0`}
                            >
                              <MoreHorizontal
                                aria-hidden="true"
                                className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handlePreview(doc)}>
                              <Eye className="mr-2 h-4 w-4" />
                              Preview
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload(doc)}>
                              <Download className="mr-2 h-4 w-4" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditingTagsDoc(doc)}>
                              <Tag className="mr-2 h-4 w-4" />
                              Edit Properties
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleBookmark(doc)}>
                              <Star
                                className={`mr-2 h-4 w-4 ${bookmarkedDocs.has(doc.id) ? 'fill-amber-400 text-amber-400' : ''}`}
                              />
                              {bookmarkedDocs.has(doc.id) ? 'Remove Bookmark' : 'Bookmark'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShowVersions(doc)}>
                              <History className="mr-2 h-4 w-4" />
                              Version History
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                const next = !doc.confidential;
                                await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
                                  method: 'PATCH',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    confidential: next,
                                  }),
                                });
                                fetchDocuments();
                              }}
                            >
                              <Lock className="mr-2 h-4 w-4" />
                              {doc.confidential ? 'Remove Confidential' : 'Mark Confidential'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(doc)}
                              className="text-danger-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminSurface>
          </div>
        </div>
      ) : (
        /* Grid / Thumbnail View */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {/* Folders — compact name-first tiles (Drive convention): the name
              is the significant information, the icon just types the tile.
              Documents keep the tall preview cards; the height difference is
              the visual distinction between containers and content. */}
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              title={folder.name}
              onClick={() => handleFolderClick(folder)}
              className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-left transition-all hover:border-amber-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-slate-800 dark:bg-slate-950/70 dark:hover:border-amber-700"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
                <Folder className="h-5 w-5 text-amber-500" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
                  {folder.name}
                </span>
                <span className="block text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                  {folder.documentCount} {folder.documentCount === 1 ? 'file' : 'files'}
                </span>
              </span>
            </button>
          ))}
          {/* Documents — render the same sorted view the list mode uses
                  so the grid and list stay coherent regardless of how the
                  user sorted via the toolbar. */}
          {sortedDocuments.map((doc) => (
            <div
              key={doc.id}
              className="group relative cursor-pointer rounded-xl border border-slate-200/80 bg-white p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/70 dark:hover:border-primary-700"
              onClick={() => handlePreview(doc)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, doc });
              }}
            >
              <DocumentThumbnail
                docId={doc.id}
                roomId={roomId}
                mimeType={doc.mimeType}
                confidential={doc.confidential || room?.allDocumentsConfidential || false}
                updatedAt={doc.updatedAt}
              />
              <div className="mt-2 flex items-center gap-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                {(doc.confidential || room?.allDocumentsConfidential) && (
                  <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <p className="text-xs text-neutral-600">{formatFileSize(doc.size)}</p>
                {doc.category && (
                  <span
                    className={`rounded-full border px-1.5 text-[9px] font-medium ${getCategoryColor(doc.category)}`}
                  >
                    {getCategoryLabel(doc.category)}
                  </span>
                )}
                {doc.expiresAt && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 text-[9px] font-medium text-orange-600">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(doc.expiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {/* Action menu */}
              <div
                className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0 shadow-sm"
                      aria-label={`Actions for ${doc.name}`}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handlePreview(doc)}>
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload(doc)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setEditingTagsDoc(doc)}>
                      <Tag className="mr-2 h-4 w-4" />
                      Edit Properties
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleBookmark(doc)}>
                      <Star
                        className={`mr-2 h-4 w-4 ${bookmarkedDocs.has(doc.id) ? 'fill-amber-400 text-amber-400' : ''}`}
                      />
                      {bookmarkedDocs.has(doc.id) ? 'Remove Bookmark' : 'Bookmark'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShowVersions(doc)}>
                      <History className="mr-2 h-4 w-4" />
                      Version History
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        const next = !doc.confidential;
                        await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ confidential: next }),
                        });
                        fetchDocuments();
                      }}
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      {doc.confidential ? 'Remove Confidential' : 'Mark Confidential'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDelete(doc)} className="text-danger-600">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mobile folder drawer for list mode. Below lg, the folder tree opens
          as a slide-in sheet so it never competes with content for width.
          Drawer state is intentionally not persisted so revisits start
          closed -- per the v3 spec. */}
      <Sheet open={folderDrawerOpen} onOpenChange={setFolderDrawerOpen}>
        <SheetContent
          side="left"
          className="lg:hidden"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            folderDrawerTriggerRef.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>Folders</SheetTitle>
            <SheetDescription>
              Browse the folder hierarchy without leaving this room.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="px-2">
            <RoomFolderTree
              folders={folderTree}
              selectedFolderId={currentFolderId}
              expandedFolderIds={expandedFolderIds}
              onSelect={handleTreeSelect}
              onToggleExpand={handleToggleExpand}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* One-time discoverability tooltip for the list-mode toggle. Educational
          only -- never auto-switches the room. Dismissed on any toggle interaction
          or close click; persists globally so it does not nag across rooms. */}
      {showListModeHint && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto fixed bottom-6 right-6 z-50 max-w-xs rounded-xl border border-primary-200 bg-white p-4 shadow-lg ring-1 ring-primary-100 dark:border-primary-800 dark:bg-slate-900 dark:ring-primary-900"
        >
          <div className="flex items-start gap-3">
            <Info
              className="mt-0.5 h-5 w-5 flex-none text-primary-600 dark:text-primary-300"
              aria-hidden="true"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Try list view
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Use list view to browse folders from a left-hand tree.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setViewMode('list');
                    setFolderPaneOpen(true);
                    dismissListModeHint();
                  }}
                >
                  Switch to list
                </Button>
                <Button size="sm" variant="ghost" onClick={dismissListModeHint}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Room drawer (Access / Share Links / Q&A / Checklist /
          Calendar). Owns its own pane data; the page only holds the
          open/pane state so the ?manage= deep link can initialize it. */}
      <ManageDrawer
        roomId={roomId}
        room={room}
        open={manageOpen}
        onOpenChange={setManageOpen}
        pane={managePane}
        onPaneChange={setManagePane}
      />

      {/* Bulk Actions Bar */}
      {selectedDocs.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-white px-4 py-2 shadow-lg">
          <span className="text-sm font-medium text-neutral-700">{selectedDocs.size} selected</span>
          <div className="mx-2 h-4 w-px bg-neutral-200" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Tag className="mr-1.5 h-3.5 w-3.5" />
                Category
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleBulkCategory(null)}>
                No category
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {CATEGORY_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => handleBulkCategory(opt.value)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Confidential
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleBulkConfidential(true)}>
                Mark Confidential
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBulkConfidential(false)}>
                Remove Confidential
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const selected = documents.filter((d) => selectedDocs.has(d.id));
              for (const doc of selected) {
                await handleDownload(doc);
              }
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-danger-600 hover:bg-danger-50"
            onClick={handleBulkDelete}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedDocs(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute rounded-xl border bg-white py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={() => {
                handlePreview(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <Eye className="h-4 w-4 text-neutral-500" /> Preview
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={() => {
                handleDownload(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <Download className="h-4 w-4 text-neutral-500" /> Download
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={() => {
                setEditingTagsDoc(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <Tag className="h-4 w-4 text-neutral-500" /> Edit Properties
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={() => {
                toggleBookmark(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <Star
                className={`h-4 w-4 ${bookmarkedDocs.has(contextMenu.doc.id) ? 'fill-amber-400 text-amber-400' : 'text-neutral-500'}`}
              />{' '}
              {bookmarkedDocs.has(contextMenu.doc.id) ? 'Remove Bookmark' : 'Bookmark'}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={() => {
                handleShowVersions(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <History className="h-4 w-4 text-neutral-500" /> Version History
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
              onClick={async () => {
                const next = !contextMenu.doc.confidential;
                await fetch(`/api/rooms/${roomId}/documents/${contextMenu.doc.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ confidential: next }),
                });
                fetchDocuments();
                setContextMenu(null);
              }}
            >
              <Lock className="h-4 w-4 text-neutral-500" />{' '}
              {contextMenu.doc.confidential ? 'Remove Confidential' : 'Mark Confidential'}
            </button>
            <div className="my-1 border-t" />
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-danger-600 hover:bg-danger-50"
              onClick={() => {
                handleDelete(contextMenu.doc);
                setContextMenu(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
            <DialogDescription>
              Upload documents to this data room. Supported formats: PDF, Word, Excel, images.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <UploadZone
              roomId={roomId}
              folderId={currentFolderId ?? undefined}
              onUploadComplete={handleUploadComplete}
              onUploadError={(error) => console.error('Upload error:', error)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Properties Dialog */}
      <EditPropertiesDialog
        doc={editingTagsDoc}
        roomId={roomId}
        onClose={() => setEditingTagsDoc(null)}
        onRefresh={fetchDocuments}
        onSaveTags={(tags) => {
          if (editingTagsDoc) {
            handleSaveTags(editingTagsDoc, tags);
          }
        }}
      />

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        open={showFolderDialog}
        onOpenChange={setShowFolderDialog}
        onCreate={handleCreateFolder}
        isCreating={isCreatingFolder}
      />

      {/* Delete Document Confirmation Dialog */}
      <DeleteDocumentDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        documentName={selectedDocument?.name}
        onCancel={() => {
          setShowDeleteDialog(false);
          setSelectedDocument(null);
        }}
        onConfirm={confirmDelete}
        isDeleting={isDeleting}
      />

      {/* Delete Folder Confirmation Dialog */}
      <DeleteFolderDialog
        open={showFolderDeleteDialog}
        onOpenChange={setShowFolderDeleteDialog}
        folderName={selectedFolder?.name}
        onCancel={() => {
          setShowFolderDeleteDialog(false);
          setSelectedFolder(null);
        }}
        onConfirm={confirmFolderDelete}
        isDeleting={isDeletingFolder}
      />

      {/* Preview Dialog */}
      <PreviewDialog
        open={showPreviewDialog}
        onOpenChange={setShowPreviewDialog}
        roomId={roomId}
        doc={selectedDocument}
        room={room}
        onDownload={() => {
          if (selectedDocument) {
            handleDownload(selectedDocument);
          }
        }}
      />

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={showVersionDialog}
        roomId={roomId}
        doc={versionDoc}
        onClose={() => {
          setShowVersionDialog(false);
          setVersionDoc(null);
        }}
        onDocumentsRefresh={fetchDocuments}
      />
    </>
  );
}

/**
 * Thumbnail for grid view — tries to load preview image, falls back to file type icon.
 */
function DocumentThumbnail({
  docId,
  roomId,
  mimeType,
  confidential = false,
  updatedAt,
}: {
  docId: string;
  roomId: string;
  mimeType: string;
  confidential?: boolean;
  updatedAt?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (confidential) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg bg-amber-50">
        <Lock className="mb-1 h-8 w-8 text-amber-400" />
        <span className="text-[10px] font-medium text-amber-500">Confidential</span>
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/rooms/${roomId}/documents/${docId}/thumbnail?v=${updatedAt || '1'}`}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileTypeIcon mimeType={mimeType} className="h-12 w-12" />
      )}
    </div>
  );
}
