'use client';

import * as React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  FileText,
  Settings,
  Upload,
  MoreHorizontal,
  Download,
  Eye,
  Trash2,
  Copy,
  BarChart3,
  History,
  ChevronRight,
  Lock,
  Tag,
  Star,
  Link2,
  Users,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { AdminEmptyState, AdminSurface } from '@/components/layout/admin-page';
import { useIsAdmin } from '@/components/layout/role-provider';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from '@/components/ui/sheet';
import dynamic from 'next/dynamic';
import { RoomFolderTree } from '@/components/rooms/RoomFolderTree';
import { useRoomNavigationPreferences } from '@/components/rooms/useRoomNavigationPreferences';
import { Info } from 'lucide-react';

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
import { toast } from '@/components/ui/use-toast';
import { CATEGORY_OPTIONS } from '@/lib/documentCategories';
import { CreateFolderDialog } from './_components/CreateFolderDialog';
import { DeleteDocumentDialog } from './_components/DeleteDocumentDialog';
import { DeleteFolderDialog } from './_components/DeleteFolderDialog';
import { EditPropertiesDialog } from './_components/EditPropertiesDialog';
import { MoveDocumentDialog } from './_components/MoveDocumentDialog';
import { ManageDrawer, isManagePane, type ManagePane } from './_components/ManageDrawer';
import { DocumentToolbar } from './_components/DocumentToolbar';
import { DocumentsTable } from './_components/DocumentsTable';
import { useRoomContents, type Document, type FolderItem } from './_hooks/useRoomContents';
import type { NameTextSize } from './_components/nameDisplay';

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = useIsAdmin();
  const roomId = params['roomId'] as string;

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
  const folderDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);

  const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null);

  // Accessibility: file/folder name text size + opt-in hover magnifier.
  // Initialized to stable defaults and hydrated from localStorage after
  // mount — render-time localStorage reads are hydration mismatches waiting
  // to happen (see the greeting incident).
  const [nameTextSize, setNameTextSize] = React.useState<NameTextSize>('default');
  const [magnifyNames, setMagnifyNames] = React.useState(false);
  React.useEffect(() => {
    try {
      const size = localStorage.getItem('vaultspace-name-size');
      if (size === 'large' || size === 'xl') {
        setNameTextSize(size);
      }
      setMagnifyNames(localStorage.getItem('vaultspace-name-magnify') === 'true');
    } catch {
      // Storage unavailable: keep defaults.
    }
  }, []);
  const handleNameTextSizeChange = React.useCallback((size: NameTextSize) => {
    setNameTextSize(size);
    try {
      localStorage.setItem('vaultspace-name-size', size);
    } catch {
      // Preference simply won't persist.
    }
  }, []);
  const handleMagnifyNamesChange = React.useCallback((enabled: boolean) => {
    setMagnifyNames(enabled);
    try {
      localStorage.setItem('vaultspace-name-magnify', String(enabled));
    } catch {
      // Preference simply won't persist.
    }
  }, []);

  const {
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
  } = useRoomContents({ roomId, categoryFilter, viewMode, listModeHintDismissed, folderPaneOpen });
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
  const [movingDoc, setMovingDoc] = React.useState<Document | null>(null);

  // Manage drawer (Access / Share Links / Q&A / Checklist / Calendar) open
  // state. Closed by default so the room canvas leads with documents, unless
  // a ?manage=<pane> deep link (e.g. from landing attention chips) requests one.
  const [manageOpen, setManageOpen] = React.useState(() =>
    isManagePane(searchParams.get('manage'))
  );

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

  // Toolbar callbacks. Kept referentially stable (empty or setter-only deps)
  // so the toolbar and memoized children never re-render from identity churn.
  const openFolderDrawer = React.useCallback(
    () => setFolderDrawerOpen(true),
    [setFolderDrawerOpen]
  );

  const openUploadDialog = React.useCallback(() => setShowUploadDialog(true), []);

  const openFolderDialog = React.useCallback(() => setShowFolderDialog(true), []);

  const handleSortChange = React.useCallback(
    (field: 'name' | 'size' | 'createdAt', dir: 'asc' | 'desc') => {
      setSortField(field);
      setSortDir(dir);
    },
    []
  );

  const handleCompactChange = React.useCallback((next: boolean) => {
    setCompact(next);
    localStorage.setItem('vaultspace-compact', String(next));
  }, []);

  const handleVisibleColumnsChange = React.useCallback((next: Record<string, boolean>) => {
    setVisibleColumns(next);
    localStorage.setItem('vaultspace-columns', JSON.stringify(next));
  }, []);

  // Toggle a single document's confidential flag. Shared by the table rows,
  // grid cards, and the right-click context menu.
  const handleToggleConfidential = React.useCallback(
    async (doc: Document) => {
      const next = !doc.confidential;
      await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidential: next }),
      });
      fetchDocuments();
    },
    [roomId, fetchDocuments]
  );

  const handleDocContextMenu = React.useCallback((e: React.MouseEvent, doc: Document) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  }, []);

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

  // Withdraw (or restore) a document. Reversible, so no confirmation dialog: a
  // withdrawn document stays as a tombstone with its retired accession number.
  const handleWithdraw = React.useCallback(
    async (doc: Document) => {
      const restore = !!doc.withdrawnAt;
      try {
        const response = await fetch(`/api/rooms/${roomId}/documents/${doc.id}/withdraw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(restore ? { restore: true } : {}),
        });
        if (response.ok) {
          fetchDocuments();
        } else {
          const error = await response.json();
          toast({
            title: 'Error',
            description: error.error || 'Failed to update withdrawal',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to update withdrawal',
          variant: 'destructive',
        });
      }
    },
    [roomId, fetchDocuments, toast]
  );

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

  // Shared props for the list-table / grid renderings of the room contents.
  // Every callback here is referentially stable (see useCallback sites) so
  // the memoized rows / tiles / cards inside DocumentsTable stay memoized.
  const documentsTableProps = {
    nameTextSize,
    magnifyNames,
    roomId,
    allDocumentsConfidential: room.allDocumentsConfidential,
    folders,
    documents: sortedDocuments,
    compact,
    visibleColumns,
    sortField,
    sortDir,
    onSort: handleSort,
    selectedDocs,
    onToggleSelectAll: toggleSelectAll,
    onToggleDocSelection: toggleDocSelection,
    bookmarkedDocs,
    onFolderClick: handleFolderClick,
    onFolderDelete: handleFolderDelete,
    onPreview: handlePreview,
    onDownload: handleDownload,
    onEditProperties: setEditingTagsDoc,
    onToggleBookmark: toggleBookmark,
    onShowVersions: handleShowVersions,
    onToggleConfidential: handleToggleConfidential,
    onWithdraw: handleWithdraw,
    onMove: setMovingDoc,
    onDelete: handleDelete,
    onContextMenu: handleDocContextMenu,
  };

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
              {isAdmin && (
                <>
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
                      <DropdownMenuItem
                        onClick={() => {
                          setManageOpen(true);
                          setManagePane('links');
                        }}
                      >
                        <Link2 className="mr-2 h-4 w-4" />
                        Share Links
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setManageOpen(true);
                          setManagePane('members');
                        }}
                      >
                        <Users className="mr-2 h-4 w-4" />
                        Access
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
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
                </>
              )}
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

        {/* Composed toolbar (Upload / New Folder, category filter, sort,
            density, columns, folder-pane + view-mode toggles). */}
        <DocumentToolbar
          nameTextSize={nameTextSize}
          onNameTextSizeChange={handleNameTextSizeChange}
          magnifyNames={magnifyNames}
          onMagnifyNamesChange={handleMagnifyNamesChange}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showListModeHint={showListModeHint}
          dismissListModeHint={dismissListModeHint}
          folderPaneOpen={folderPaneOpen}
          toggleFolderPane={toggleFolderPane}
          folderDrawerTriggerRef={folderDrawerTriggerRef}
          onOpenFolderDrawer={openFolderDrawer}
          onUploadClick={openUploadDialog}
          onNewFolderClick={openFolderDialog}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          compact={compact}
          onCompactChange={handleCompactChange}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={handleVisibleColumnsChange}
        />
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
      ) : (
        /* Both views share the split-pane wrapper: the folder rail is an
           option in grid view too (QA tester request), not a list-only
           feature. */
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
            <DocumentsTable view={viewMode} {...documentsTableProps} />
          </div>
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
                await handleToggleConfidential(contextMenu.doc);
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

      {/* Move Document Dialog */}
      <MoveDocumentDialog
        doc={movingDoc}
        roomId={roomId}
        onClose={() => setMovingDoc(null)}
        onMoved={fetchDocuments}
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
