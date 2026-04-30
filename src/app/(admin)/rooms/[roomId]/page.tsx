'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  Users,
  Link as LinkIcon,
  Settings,
  Upload,
  Plus,
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
  RotateCcw,
  Loader2,
  AlertCircle,
  MessageSquare,
  ClipboardCheck,
  CalendarDays,
  Star,
  Clock,
  UserPlus,
  Check,
  X,
  Mail,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { QATab } from '@/components/rooms/QATab';
import { ChecklistTab } from '@/components/rooms/ChecklistTab';
import { CalendarTab } from '@/components/rooms/CalendarTab';
import { UploadZone } from '@/components/documents/UploadZone';
import { TextPreviewRenderer } from '@/components/documents/TextPreviewRenderer';
import { FileTypeIcon } from '@/components/documents/FileTypeIcon';
import { WatermarkOverlay } from '@/components/documents/WatermarkOverlay';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { CATEGORY_OPTIONS, getCategoryLabel, getCategoryColor } from '@/lib/documentCategories';

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

interface Admin {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  scope: 'organization' | 'room';
}

interface AccessRequest {
  id: string;
  requesterEmail: string;
  requesterName: string | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface Viewer {
  email: string;
  name: string | null;
  visits: number;
  lastActive: string;
  totalTimeSpent: number;
  linkName: string | null;
  linkId: string | null;
  isActive: boolean;
}

interface ShareLink {
  id: string;
  name: string | null;
  slug: string;
  permission: 'VIEW' | 'DOWNLOAD';
  requiresPassword: boolean;
  requiresEmailVerification: boolean;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { visits: number };
}

interface DocumentVersionInfo {
  id: string;
  versionNumber: number;
  fileName: string;
  fileSize: string;
  mimeType: string;
  changeDescription: string | null;
  scanStatus: string;
  previewStatus: string;
  createdAt: string;
  uploadedByUser: { firstName: string; lastName: string; email: string } | null;
}

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [room, setRoom] = React.useState<Room | null>(null);
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [folders, setFolders] = React.useState<FolderItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = React.useState<BreadcrumbItem[]>([
    { id: null, name: 'Root' },
  ]);
  const [admins, setAdmins] = React.useState<Admin[]>([]);
  const [links, setLinks] = React.useState<ShareLink[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  // Drawer-internal pane state. Documents are the page body now, not a tab,
  // so this only chooses which secondary surface (Access / Share Links /
  // Q&A / Checklist / Calendar) is visible inside the Manage Room drawer.
  const [managePane, setManagePane] = React.useState<
    'members' | 'links' | 'qa' | 'checklist' | 'calendar'
  >('members');
  const [viewMode, setViewMode] = React.useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('vaultspace-doc-view') as 'list' | 'grid') || 'list';
    }
    return 'list';
  });

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
  const [showMemberDialog, setShowMemberDialog] = React.useState(false);
  const [showLinkDialog, setShowLinkDialog] = React.useState(false);
  const [showFolderDialog, setShowFolderDialog] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = React.useState(false);
  const [selectedDocument, setSelectedDocument] = React.useState<Document | null>(null);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  // Version history states
  const [showVersionDialog, setShowVersionDialog] = React.useState(false);
  const [versionDoc, setVersionDoc] = React.useState<Document | null>(null);
  const [versions, setVersions] = React.useState<DocumentVersionInfo[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = React.useState(false);
  const [isRollingBack, setIsRollingBack] = React.useState(false);
  const [isUploadingVersion, setIsUploadingVersion] = React.useState(false);
  const [versionPreviewUrl, setVersionPreviewUrl] = React.useState<string | null>(null);
  const [versionPreviewId, setVersionPreviewId] = React.useState<string | null>(null);
  const versionFileRef = React.useRef<HTMLInputElement>(null);

  // Folder delete states
  const [showFolderDeleteDialog, setShowFolderDeleteDialog] = React.useState(false);
  const [selectedFolder, setSelectedFolder] = React.useState<FolderItem | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = React.useState(false);

  // Link create states
  const [newLinkName, setNewLinkName] = React.useState('');
  const [newLinkPermission, setNewLinkPermission] = React.useState<'VIEW' | 'DOWNLOAD'>('VIEW');
  const [newLinkPassword, setNewLinkPassword] = React.useState('');
  const [newLinkExpiry, setNewLinkExpiry] = React.useState('');
  const [newLinkSessionLimit, setNewLinkSessionLimit] = React.useState('');
  const [isCreatingLink, setIsCreatingLink] = React.useState(false);

  // Confirmation dialog states
  const [deleteLinkTarget, setDeleteLinkTarget] = React.useState<ShareLink | null>(null);
  const [isDeletingLink, setIsDeletingLink] = React.useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = React.useState<Admin | null>(null);
  const [isRemovingMember, setIsRemovingMember] = React.useState(false);

  // Tag editor states
  const [editingTagsDoc, setEditingTagsDoc] = React.useState<Document | null>(null);
  const [tagInput, setTagInput] = React.useState('');

  // Access request states
  const [accessRequests, setAccessRequests] = React.useState<AccessRequest[]>([]);
  const [_isLoadingAccessRequests, setIsLoadingAccessRequests] = React.useState(false);
  const [reviewingRequestId, setReviewingRequestId] = React.useState<string | null>(null);
  const [viewers, setViewers] = React.useState<Viewer[]>([]);
  const [isLoadingViewers, setIsLoadingViewers] = React.useState(false);
  const [showInviteViewerDialog, setShowInviteViewerDialog] = React.useState(false);
  const [inviteViewerEmails, setInviteViewerEmails] = React.useState('');
  const [isInvitingViewers, setIsInvitingViewers] = React.useState(false);
  const [revokingViewerEmail, setRevokingViewerEmail] = React.useState<string | null>(null);

  // Member add states
  const [newMemberEmail, setNewMemberEmail] = React.useState('');
  const [isAddingMember, setIsAddingMember] = React.useState(false);

  // Manage drawer (Access / Share Links / Q&A / Checklist / Calendar) open
  // state. Closed by default so the room canvas leads with documents.
  const [manageOpen, setManageOpen] = React.useState(false);

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

  const fetchAdmins = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/admins`);
      if (response.ok) {
        const data = await response.json();
        setAdmins(data.admins || []);
      }
    } catch (error) {
      console.error('Failed to fetch admins:', error);
    }
  }, [roomId]);

  const fetchAccessRequests = React.useCallback(async () => {
    setIsLoadingAccessRequests(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/access-requests?status=PENDING`);
      if (response.ok) {
        const data = await response.json();
        setAccessRequests(data.accessRequests || []);
      }
    } catch (error) {
      console.error('Failed to fetch access requests:', error);
    } finally {
      setIsLoadingAccessRequests(false);
    }
  }, [roomId]);

  const fetchViewers = React.useCallback(async () => {
    setIsLoadingViewers(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/viewers`);
      if (response.ok) {
        const data = await response.json();
        setViewers(data.viewers || []);
      }
    } catch (error) {
      console.error('Failed to fetch viewers:', error);
    } finally {
      setIsLoadingViewers(false);
    }
  }, [roomId]);

  const handleInviteViewers = React.useCallback(async () => {
    const emails = inviteViewerEmails
      .split('\n')
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (emails.length === 0) {
      toast({
        title: 'Error',
        description: 'Please enter at least one valid email',
        variant: 'destructive',
      });
      return;
    }

    setIsInvitingViewers(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/viewers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: 'Success',
          description: `Invited ${data.invited} viewer(s)`,
          variant: 'success',
        });
        setShowInviteViewerDialog(false);
        setInviteViewerEmails('');
        fetchViewers();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to invite viewers',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Invite viewers error:', error);
      toast({ title: 'Error', description: 'Failed to invite viewers', variant: 'destructive' });
    } finally {
      setIsInvitingViewers(false);
    }
  }, [roomId, inviteViewerEmails, fetchViewers]);

  const handleRevokeViewer = React.useCallback(
    async (email: string) => {
      setRevokingViewerEmail(email);
      try {
        const response = await fetch(`/api/rooms/${roomId}/viewers`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: [email] }),
        });

        if (response.ok) {
          toast({ title: 'Success', description: 'Viewer access revoked', variant: 'success' });
          fetchViewers();
        } else {
          const error = await response.json();
          toast({
            title: 'Error',
            description: error.error || 'Failed to revoke access',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Revoke viewer error:', error);
        toast({ title: 'Error', description: 'Failed to revoke access', variant: 'destructive' });
      } finally {
        setRevokingViewerEmail(null);
      }
    },
    [roomId, fetchViewers]
  );

  const handleReviewAccessRequest = React.useCallback(
    async (requestId: string, status: 'APPROVED' | 'DENIED') => {
      setReviewingRequestId(requestId);
      try {
        const response = await fetch(`/api/rooms/${roomId}/access-requests/${requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });

        if (response.ok) {
          toast({
            title: 'Success',
            description: `Access request ${status.toLowerCase()}`,
            variant: 'success',
          });
          fetchAccessRequests();
        } else {
          const error = await response.json();
          toast({
            title: 'Error',
            description: error.error || 'Failed to review access request',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Review access request error:', error);
        toast({
          title: 'Error',
          description: 'Failed to review access request',
          variant: 'destructive',
        });
      } finally {
        setReviewingRequestId(null);
      }
    },
    [roomId, fetchAccessRequests]
  );

  const fetchLinks = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/links`);
      if (response.ok) {
        const data = await response.json();
        setLinks(data.links || []);
      }
    } catch (error) {
      console.error('Failed to fetch links:', error);
    }
  }, [roomId]);

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

  // Documents are the always-on page body — fetch them as soon as the room
  // loads, regardless of whether the manage drawer is open.
  React.useEffect(() => {
    if (room) {
      fetchDocuments();
      fetchFolders();
      fetchBookmarks();
    }
  }, [room, fetchDocuments, fetchFolders, fetchBookmarks]);

  // Refetch documents when navigating folders.
  React.useEffect(() => {
    if (room) {
      fetchDocuments();
      fetchFolders();
    }
  }, [currentFolderId, room, fetchDocuments, fetchFolders]);

  // Lazy-load the manage drawer's pane data only when it opens or the user
  // switches panes. Q&A / Checklist / Calendar sub-components own their own
  // data fetching; the page only fetches the panes whose state lives here.
  React.useEffect(() => {
    if (!manageOpen || !room) {
      return;
    }
    if (managePane === 'members') {
      fetchAdmins();
      fetchAccessRequests();
      fetchViewers();
    } else if (managePane === 'links') {
      fetchLinks();
    }
  }, [manageOpen, managePane, room, fetchAdmins, fetchAccessRequests, fetchViewers, fetchLinks]);

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
  const handleCreateFolder = React.useCallback(async () => {
    if (!newFolderName.trim()) {
      return;
    }

    setIsCreatingFolder(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: currentFolderId,
        }),
      });

      if (response.ok) {
        setShowFolderDialog(false);
        setNewFolderName('');
        fetchFolders(); // Refresh folders for immediate visibility
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
  }, [roomId, newFolderName, currentFolderId, fetchFolders]);

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

  // Handle document preview
  const handlePreview = React.useCallback(
    async (doc: Document) => {
      setSelectedDocument(doc);
      setPreviewUrl(null);
      setPreviewError(null);
      setShowPreviewDialog(true);

      // Types that can be previewed (inline or via client-side renderer)
      // All types we can preview — inline, via Gotenberg conversion, or client-side rendering
      const previewableTypes = [
        // Inline (served directly)
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/tiff',
        'image/svg+xml',
        // Client-side rendered
        'text/plain',
        'text/csv',
        'text/markdown',
        'text/html',
        'text/yaml',
        'text/xml',
        'application/json',
        'application/xml',
        // Gotenberg conversion (office formats → PDF)
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
        'application/msword', // DOC
        'application/vnd.ms-excel', // XLS
        'application/vnd.ms-powerpoint', // PPT
        'application/vnd.oasis.opendocument.text', // ODT
        'application/vnd.oasis.opendocument.spreadsheet', // ODS
        'application/vnd.oasis.opendocument.presentation', // ODP
        'application/vnd.oasis.opendocument.graphics', // ODG
        'application/vnd.ms-visio.drawing.main+xml', // VSDX
        'application/vnd.visio', // VSD
        'application/rtf',
        'application/epub+zip',
      ];

      if (previewableTypes.includes(doc.mimeType)) {
        setPreviewUrl(`/api/rooms/${roomId}/documents/${doc.id}/preview`);
      } else {
        setPreviewError('Preview not available for this file type. Use download instead.');
      }
    },
    [roomId]
  );

  // Handle version history
  const handleShowVersions = React.useCallback(
    async (doc: Document) => {
      setVersionDoc(doc);
      setShowVersionDialog(true);
      setIsLoadingVersions(true);
      setVersionPreviewUrl(null);
      setVersionPreviewId(null);
      try {
        const res = await fetch(`/api/rooms/${roomId}/documents/${doc.id}/versions`);
        if (res.ok) {
          const data = await res.json();
          setVersions(data.versions || []);
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to load versions', variant: 'destructive' });
      } finally {
        setIsLoadingVersions(false);
      }
    },
    [roomId]
  );

  const handleRollback = React.useCallback(
    async (versionId: string, versionNumber: number) => {
      if (!versionDoc) {
        return;
      }
      setIsRollingBack(true);
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/documents/${versionDoc.id}/versions/${versionId}/rollback`,
          { method: 'POST' }
        );
        if (res.ok) {
          toast({ title: 'Rolled back', description: `Restored to version ${versionNumber}` });
          fetchDocuments();
          handleShowVersions(versionDoc);
        } else {
          const data = await res.json();
          toast({
            title: 'Rollback failed',
            description: data.error?.message || 'Could not rollback',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to rollback version',
          variant: 'destructive',
        });
      } finally {
        setIsRollingBack(false);
      }
    },
    [roomId, versionDoc, fetchDocuments, handleShowVersions]
  );

  const handleUploadNewVersion = React.useCallback(
    async (file: File) => {
      if (!versionDoc) {
        return;
      }
      setIsUploadingVersion(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/rooms/${roomId}/documents/${versionDoc.id}/versions`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          toast({ title: 'Version uploaded', description: 'New version uploaded successfully' });
          fetchDocuments();
          handleShowVersions(versionDoc);
        } else {
          const data = await res.json();
          toast({
            title: 'Upload failed',
            description: data.error?.message || 'Could not upload version',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to upload new version',
          variant: 'destructive',
        });
      } finally {
        setIsUploadingVersion(false);
      }
    },
    [roomId, versionDoc, fetchDocuments, handleShowVersions]
  );

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
  }, [roomId, selectedFolder, fetchFolders, fetchDocuments]);

  // Handle share link creation
  const handleCreateLink = React.useCallback(async () => {
    if (!newLinkName.trim()) {
      toast({ title: 'Required', description: 'Please enter a link name' });
      return;
    }

    setIsCreatingLink(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLinkName.trim(),
          permission: newLinkPermission,
          scope: 'ENTIRE_ROOM',
          ...(newLinkPassword && { password: newLinkPassword }),
          ...(newLinkExpiry && { expiresAt: new Date(newLinkExpiry).toISOString() }),
          ...(newLinkSessionLimit && { maxSessionMinutes: parseInt(newLinkSessionLimit, 10) }),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setShowLinkDialog(false);
        setNewLinkName('');
        setNewLinkPermission('VIEW');
        setNewLinkPassword('');
        setNewLinkExpiry('');
        setNewLinkSessionLimit('');
        fetchLinks();
        // Copy link URL to clipboard
        if (data.link?.url) {
          await navigator.clipboard.writeText(data.link.url);
          toast({
            title: 'Success',
            description: 'Link created and copied to clipboard!',
            variant: 'success',
          });
        }
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to create link',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Create link error:', error);
      toast({ title: 'Error', description: 'Failed to create link', variant: 'destructive' });
    } finally {
      setIsCreatingLink(false);
    }
  }, [
    roomId,
    newLinkName,
    newLinkPermission,
    newLinkPassword,
    newLinkExpiry,
    newLinkSessionLimit,
    fetchLinks,
  ]);

  // Handle copy link
  const handleCopyLink = React.useCallback(async (link: ShareLink) => {
    const baseUrl = window.location.origin;
    const linkUrl = `${baseUrl}/r/${link.slug}`;
    try {
      await navigator.clipboard.writeText(linkUrl);
      toast({ title: 'Copied', description: 'Link copied to clipboard!', variant: 'success' });
    } catch (error) {
      console.error('Copy error:', error);
      toast({ title: 'Error', description: 'Failed to copy link', variant: 'destructive' });
    }
  }, []);

  // Handle delete link
  const handleDeleteLinkClick = React.useCallback((link: ShareLink) => {
    setDeleteLinkTarget(link);
  }, []);

  const handleDeleteLinkConfirm = React.useCallback(async () => {
    if (!deleteLinkTarget) {
      return;
    }

    setIsDeletingLink(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/links/${deleteLinkTarget.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchLinks();
        setDeleteLinkTarget(null);
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to delete link',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Delete link error:', error);
      toast({ title: 'Error', description: 'Failed to delete link', variant: 'destructive' });
    } finally {
      setIsDeletingLink(false);
    }
  }, [roomId, fetchLinks, deleteLinkTarget]);

  // Handle add member (room admin)
  const handleAddMember = React.useCallback(async () => {
    if (!newMemberEmail.trim()) {
      toast({ title: 'Required', description: 'Please enter an email address' });
      return;
    }

    setIsAddingMember(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newMemberEmail.trim(),
        }),
      });

      if (response.ok) {
        setShowMemberDialog(false);
        setNewMemberEmail('');
        fetchAdmins();
        toast({ title: 'Success', description: 'Admin added successfully!', variant: 'success' });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to add admin',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Add member error:', error);
      toast({ title: 'Error', description: 'Failed to add admin', variant: 'destructive' });
    } finally {
      setIsAddingMember(false);
    }
  }, [roomId, newMemberEmail, fetchAdmins]);

  // Handle remove member
  const handleRemoveMemberClick = React.useCallback((admin: Admin) => {
    setRemoveMemberTarget(admin);
  }, []);

  const handleRemoveMemberConfirm = React.useCallback(async () => {
    if (!removeMemberTarget) {
      return;
    }

    setIsRemovingMember(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/admins/${removeMemberTarget.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchAdmins();
        setRemoveMemberTarget(null);
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to remove admin',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Remove member error:', error);
      toast({ title: 'Error', description: 'Failed to remove admin', variant: 'destructive' });
    } finally {
      setIsRemovingMember(false);
    }
  }, [roomId, fetchAdmins, removeMemberTarget]);

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

        The plane is intentionally soft (gradient fades to white toward the
        document grid) so it provides identity without becoming a hero band.
      */}
      <div className="mb-5 rounded-2xl border border-primary-100/80 bg-gradient-to-b from-primary-50/70 via-white to-white p-4 shadow-sm dark:border-primary-900/30 dark:from-primary-950/30 dark:via-slate-950 dark:to-slate-950 lg:p-5">
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setShowUploadDialog(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowFolderDialog(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            {/* Visual separator between primary actions and secondary
                browsing utilities. Keeps the row readable as two clusters. */}
            <div aria-hidden="true" className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
            {/* SelectTrigger ships with `w-full` baked in, so the trigger
                    fills its parent. Wrap each select in a fixed-width
                    flex-none div so the row doesn't expand them and they sit
                    inline with Upload / New Folder. */}
            <div className="w-[170px] flex-none">
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
            <div className="w-[180px] flex-none">
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
            {/* Compact toggle (list view only) */}
            {viewMode === 'list' && (
              <button
                onClick={() => {
                  const next = !compact;
                  setCompact(next);
                  localStorage.setItem('vaultspace-compact', String(next));
                }}
                className={`rounded-md border p-1.5 transition-colors ${compact ? 'border-primary-200 bg-primary-50 text-primary-600' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}
                title={compact ? 'Standard density' : 'Compact density'}
              >
                <Minus className="h-4 w-4" />
              </button>
            )}
            {/* Column picker (list view only) */}
            {viewMode === 'list' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="rounded-md border border-transparent p-1.5 text-neutral-400 transition-colors hover:text-neutral-600"
                    title="Show/hide columns"
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
                  localStorage.setItem('vaultspace-doc-view', 'list');
                }}
                className={`rounded-md p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200 dark:bg-slate-950 dark:text-primary-200 dark:ring-primary-800'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
                aria-pressed={viewMode === 'list'}
                aria-label="List view"
                title="List view"
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => {
                  setViewMode('grid');
                  localStorage.setItem('vaultspace-doc-view', 'grid');
                }}
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

      {folders.length === 0 && documents.length === 0 ? (
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
        <AdminSurface className="overflow-hidden p-0">
          <table className="w-full">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
              <tr>
                <th className="w-8 px-2 py-2">
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center text-neutral-400 hover:text-neutral-600"
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
                    className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700"
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
                    className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700"
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
                      <Folder className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-yellow-500`} />
                      <span className={`font-medium ${compact ? 'text-sm' : ''}`}>
                        {folder.name}
                      </span>
                    </div>
                  </td>
                  {visibleColumns['size'] && (
                    <td
                      className={`px-3 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                    >
                      {folder.documentCount} files, {folder.childCount} folders
                    </td>
                  )}
                  {visibleColumns['uploaded'] && (
                    <td
                      className={`px-3 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
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
                          className={`${compact ? 'h-6 w-6' : 'h-7 w-7'} p-0`}
                        >
                          <MoreHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
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
                              <Badge key={tag} variant="outline" className="px-1 py-0 text-[10px]">
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
                      className={`px-3 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
                    >
                      {formatFileSize(doc.size)}
                    </td>
                  )}
                  {visibleColumns['uploaded'] && (
                    <td
                      className={`px-3 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
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
                          className={`${compact ? 'h-6 w-6' : 'h-7 w-7'} p-0`}
                        >
                          <MoreHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
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
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingTagsDoc(doc);
                            setTagInput((doc.tags || []).join(', '));
                          }}
                        >
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
      ) : (
        /* Grid / Thumbnail View */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {/* Folders */}
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="group cursor-pointer rounded-xl border border-slate-200/80 bg-white p-3 transition-all hover:border-sky-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/70 dark:hover:border-sky-800"
              onClick={() => handleFolderClick(folder)}
            >
              <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-amber-50">
                <Folder className="h-12 w-12 text-amber-500" />
              </div>
              <p className="mt-2 truncate text-sm font-medium">{folder.name}</p>
              <p className="text-xs text-neutral-400">{folder.documentCount} files</p>
            </div>
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
                <p className="text-xs text-neutral-400">{formatFileSize(doc.size)}</p>
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
                    <Button variant="secondary" size="sm" className="h-7 w-7 p-0 shadow-sm">
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
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingTagsDoc(doc);
                        setTagInput((doc.tags || []).join(', '));
                      }}
                    >
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

      {/* Manage Room drawer. Holds the secondary room surfaces (Access,
          Share Links, Q&A, Checklist, Calendar) so the page canvas can stay
          documents-first. Heavier admin surfaces (Settings, Audit,
          Analytics, Trash) remain dedicated routes accessible from the
          PageHeader More menu, not crammed into the drawer. */}
      <Sheet open={manageOpen} onOpenChange={setManageOpen}>
        <SheetContent className="p-0">
          <SheetHeader className="pr-12">
            <SheetTitle>Manage room</SheetTitle>
            <SheetDescription>
              Control who has access, generate share links, and run room workflows without leaving
              the document workspace.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <Tabs
              value={managePane}
              onValueChange={(v) => setManagePane(v as typeof managePane)}
              className="flex h-full"
            >
              {/* Vertical pane nav. Reads as a distinct rail layer (slightly
                  darker tint than the content pane on the right) so the
                  drawer feels like a tool panel, not a flat modal. The
                  active section uses the same primary accent that anchors
                  the room canvas — keeping the entire room on a single
                  controlled accent system. */}
              <TabsList
                aria-label="Room management sections"
                className="flex h-full w-48 shrink-0 flex-col items-stretch justify-start gap-1 rounded-none border-r border-slate-200 bg-slate-100/80 p-2 dark:border-slate-800 dark:bg-slate-900/60"
              >
                {[
                  { value: 'members', icon: Users, label: 'Access' },
                  { value: 'links', icon: LinkIcon, label: 'Share Links' },
                  { value: 'qa', icon: MessageSquare, label: 'Q&A' },
                  { value: 'checklist', icon: ClipboardCheck, label: 'Checklist' },
                  { value: 'calendar', icon: CalendarDays, label: 'Calendar' },
                ].map(({ value, icon: Icon, label }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="justify-start gap-2 rounded-md bg-transparent px-3 py-2 text-sm font-medium text-slate-600 shadow-none transition-colors hover:bg-white/70 hover:text-slate-900 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-800 data-[state=active]:shadow-none data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-primary-200 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100 dark:data-[state=active]:bg-primary-900/30 dark:data-[state=active]:text-primary-100 dark:data-[state=active]:ring-primary-800"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="min-w-0 flex-1 overflow-y-auto bg-white p-5 dark:bg-slate-950">
                {/* Members pane */}
                <TabsContent value="members" className="mt-0">
                  {/* Access Requests Section */}
                  {accessRequests.length > 0 && (
                    <Card className="mb-6 border-amber-200 bg-amber-50/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <UserPlus className="h-5 w-5 text-amber-600" />
                          <CardTitle className="text-base">
                            Pending Access Requests
                            <Badge variant="warning" className="ml-2">
                              {accessRequests.length}
                            </Badge>
                          </CardTitle>
                        </div>
                        <CardDescription>
                          People requesting access to this room. Approve to create a share link.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {accessRequests.map((req) => (
                          <div
                            key={req.id}
                            className="flex items-center justify-between rounded-lg border bg-white p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-neutral-400" />
                                <span className="font-medium text-neutral-900">
                                  {req.requesterName || req.requesterEmail}
                                </span>
                                {req.requesterName && (
                                  <span className="text-sm text-neutral-500">
                                    {req.requesterEmail}
                                  </span>
                                )}
                              </div>
                              {req.reason && (
                                <p className="mt-1 line-clamp-2 text-sm text-neutral-600">
                                  {req.reason}
                                </p>
                              )}
                              <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                                <Clock className="h-3 w-3" />
                                {new Date(req.createdAt).toLocaleDateString()} at{' '}
                                {new Date(req.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                            <div className="ml-4 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-200 text-red-600 hover:bg-red-50"
                                disabled={reviewingRequestId === req.id}
                                onClick={() => handleReviewAccessRequest(req.id, 'DENIED')}
                              >
                                <X className="mr-1 h-3.5 w-3.5" />
                                Deny
                              </Button>
                              <Button
                                size="sm"
                                disabled={reviewingRequestId === req.id}
                                onClick={() => handleReviewAccessRequest(req.id, 'APPROVED')}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                Approve
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Slim section header — drawer width is precious; the
                      drawer title already names this surface, so we don't
                      need a second descriptive paragraph here. */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Admins
                    </h3>
                    <Button size="sm" onClick={() => setShowMemberDialog(true)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add Admin
                    </Button>
                  </div>

                  {admins.length === 0 ? (
                    <AdminEmptyState
                      icon={<Users className="h-6 w-6" />}
                      title="No admins yet"
                      description="Add room-specific admins when you need collaborators to manage content, access, and links without giving org-wide privileges."
                      action={
                        <Button onClick={() => setShowMemberDialog(true)}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Admin
                        </Button>
                      }
                    />
                  ) : (
                    <AdminSurface className="overflow-hidden p-0">
                      <table className="w-full">
                        <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                              Admin
                            </th>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                              Scope
                            </th>
                            <th className="w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {admins.map((admin) => (
                            <tr
                              key={admin.id}
                              className="border-b last:border-0 hover:bg-neutral-50"
                            >
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-3">
                                  <UserAvatar
                                    name={`${admin.firstName} ${admin.lastName}`}
                                    size="sm"
                                  />
                                  <div>
                                    <div className="font-medium">
                                      {admin.firstName} {admin.lastName}
                                    </div>
                                    <div className="text-sm text-neutral-500">{admin.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  variant={admin.scope === 'organization' ? 'default' : 'secondary'}
                                >
                                  {admin.scope === 'organization' ? 'Org Admin' : 'Room Admin'}
                                </Badge>
                              </td>
                              <td className="px-4 py-2">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {admin.scope === 'room' && (
                                      <DropdownMenuItem
                                        onClick={() => handleRemoveMemberClick(admin)}
                                        className="text-danger-600"
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Remove
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </AdminSurface>
                  )}

                  {/* Viewers Section */}
                  <Card className="bg-white/88 mt-6 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Eye className="h-5 w-5 text-neutral-500" />
                          <CardTitle className="text-base">Viewers</CardTitle>
                          {viewers.length > 0 && (
                            <Badge variant="secondary">{viewers.length}</Badge>
                          )}
                        </div>
                        <Button size="sm" onClick={() => setShowInviteViewerDialog(true)}>
                          <UserPlus className="mr-2 h-4 w-4" />
                          Invite Viewers
                        </Button>
                      </div>
                      <CardDescription>
                        External viewers who have accessed this room via share links.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {isLoadingViewers ? (
                        <div className="space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : viewers.length === 0 ? (
                        <p className="py-4 text-center text-sm text-neutral-500">
                          No viewers have accessed this room yet.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <table className="w-full">
                            <thead className="border-b bg-neutral-50">
                              <tr>
                                <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                                  Email
                                </th>
                                <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                                  Name
                                </th>
                                <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                                  Visits
                                </th>
                                <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                                  Last Active
                                </th>
                                <th className="px-4 py-2.5 text-left text-sm font-medium text-neutral-500">
                                  Time Spent
                                </th>
                                <th className="w-10"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {viewers.map((viewer) => (
                                <tr
                                  key={viewer.email}
                                  className="border-b last:border-0 hover:bg-neutral-50"
                                >
                                  <td className="px-4 py-2 text-sm font-medium text-neutral-900">
                                    {viewer.email}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-neutral-600">
                                    {viewer.name || '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-neutral-600">
                                    {viewer.visits}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-neutral-600">
                                    {new Date(viewer.lastActive).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-neutral-600">
                                    {viewer.totalTimeSpent < 60
                                      ? `${viewer.totalTimeSpent}s`
                                      : viewer.totalTimeSpent < 3600
                                        ? `${Math.round(viewer.totalTimeSpent / 60)}m`
                                        : `${Math.round(viewer.totalTimeSpent / 3600)}h`}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                                      disabled={revokingViewerEmail === viewer.email}
                                      onClick={() => handleRevokeViewer(viewer.email)}
                                    >
                                      {revokingViewerEmail === viewer.email ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Invite Viewers Dialog */}
                  <Dialog open={showInviteViewerDialog} onOpenChange={setShowInviteViewerDialog}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite Viewers</DialogTitle>
                        <DialogDescription>
                          Enter email addresses to invite as viewers (one per line). A view-only
                          share link will be created for each.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Label htmlFor="viewer-emails">Email Addresses</Label>
                        <Textarea
                          id="viewer-emails"
                          placeholder={'viewer1@example.com\nviewer2@example.com'}
                          value={inviteViewerEmails}
                          onChange={(e) => setInviteViewerEmails(e.target.value)}
                          className="mt-1.5"
                          rows={6}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowInviteViewerDialog(false);
                            setInviteViewerEmails('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleInviteViewers}
                          disabled={isInvitingViewers || !inviteViewerEmails.trim()}
                        >
                          {isInvitingViewers ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Inviting...
                            </>
                          ) : (
                            'Invite'
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </TabsContent>

                {/* Links Tab */}
                <TabsContent value="links" className="mt-0">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Share links
                    </h3>
                    <Button size="sm" onClick={() => setShowLinkDialog(true)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Create Link
                    </Button>
                  </div>

                  {links.length === 0 ? (
                    <AdminEmptyState
                      icon={<LinkIcon className="h-6 w-6" />}
                      title="No share links yet"
                      description="Create share links to give external reviewers secure access to this room with the right view and download permissions."
                      action={
                        <Button onClick={() => setShowLinkDialog(true)}>
                          <Plus className="mr-2 h-4 w-4" />
                          Create Link
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-4">
                      {links.map((link) => (
                        <Card
                          key={link.id}
                          className="bg-white/88 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5"
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-base">
                                  {link.name || 'Unnamed Link'}
                                </CardTitle>
                                <CardDescription className="mt-1 flex items-center gap-2">
                                  <Badge
                                    variant={
                                      link.permission === 'DOWNLOAD' ? 'default' : 'secondary'
                                    }
                                  >
                                    {link.permission === 'DOWNLOAD'
                                      ? 'View & Download'
                                      : 'View Only'}
                                  </Badge>
                                  {link.requiresPassword && (
                                    <Badge variant="warning">Password</Badge>
                                  )}
                                  {link.requiresEmailVerification && (
                                    <Badge variant="secondary">Email Required</Badge>
                                  )}
                                  {!link.isActive && <Badge variant="danger">Disabled</Badge>}
                                </CardDescription>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleCopyLink(link)}>
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy Link
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteLinkClick(link)}
                                    className="text-danger-600"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-6 text-sm text-neutral-500">
                              <div>
                                <span className="font-medium text-neutral-900">
                                  {link._count?.visits || 0}
                                </span>{' '}
                                visits
                              </div>
                              <div>Created {formatDate(link.createdAt)}</div>
                              {link.expiresAt && <div>Expires {formatDate(link.expiresAt)}</div>}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Q&A Tab */}
                <TabsContent value="qa" className="mt-4">
                  <QATab roomId={roomId} />
                </TabsContent>

                {/* Checklist Tab */}
                <TabsContent value="checklist" className="mt-4">
                  <ChecklistTab roomId={roomId} />
                </TabsContent>

                {/* Calendar Tab */}
                <TabsContent value="calendar" className="mt-0">
                  <CalendarTab roomId={roomId} />
                </TabsContent>
              </div>
            </Tabs>
          </SheetBody>
          {/* Footer: pointers to the dedicated full-page admin surfaces.
              These are too heavy to live in the drawer (per the IA: settings,
              audit, analytics, trash get their own routes), but the drawer
              is the natural launching point. */}
          <div className="border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Open as full page
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/rooms/${roomId}/settings`)}
              >
                <Settings className="mr-1.5 h-4 w-4" aria-hidden="true" /> Settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/rooms/${roomId}/audit`)}
              >
                <History className="mr-1.5 h-4 w-4" aria-hidden="true" /> Audit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/rooms/${roomId}/analytics`)}
              >
                <BarChart3 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Analytics
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/rooms/${roomId}/trash`)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Trash
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
                setTagInput((contextMenu.doc.tags || []).join(', '));
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

      {/* Add Member Dialog */}
      <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Room Admin</DialogTitle>
            <DialogDescription>
              Add a team member as an admin of this data room. They must have an existing account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="memberEmail">Email Address</Label>
              <Input
                id="memberEmail"
                type="email"
                placeholder="member@example.com"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isAddingMember) {
                    handleAddMember();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowMemberDialog(false);
                setNewMemberEmail('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddMember} disabled={isAddingMember || !newMemberEmail.trim()}>
              {isAddingMember ? 'Adding...' : 'Add Admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Properties Dialog */}
      <Dialog
        open={!!editingTagsDoc}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTagsDoc(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Properties</DialogTitle>
            <DialogDescription>
              Update tags and category for &quot;{editingTagsDoc?.name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={editingTagsDoc?.category ?? 'none'}
                onValueChange={async (v) => {
                  if (editingTagsDoc) {
                    await fetch(`/api/rooms/${roomId}/documents/${editingTagsDoc.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ category: v === 'none' ? null : v }),
                    });
                    fetchDocuments();
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <Input
                placeholder="confidential, financial, q4-2026"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editingTagsDoc) {
                    const tags = tagInput
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean);
                    handleSaveTags(editingTagsDoc, tags);
                  }
                }}
              />
              <p className="text-xs text-neutral-400">Separate tags with commas</p>
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Date</Label>
              <Input
                type="datetime-local"
                value={
                  editingTagsDoc?.expiresAt
                    ? new Date(editingTagsDoc.expiresAt).toISOString().slice(0, 16)
                    : ''
                }
                onChange={async (e) => {
                  if (editingTagsDoc) {
                    const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                    await fetch(`/api/rooms/${roomId}/documents/${editingTagsDoc.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ expiresAt: val }),
                    });
                    fetchDocuments();
                  }
                }}
              />
              <p className="text-xs text-neutral-400">
                Document will auto-archive or delete after this date
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Action</Label>
              <Select
                value={editingTagsDoc?.expiryAction ?? 'ARCHIVE'}
                onValueChange={async (v) => {
                  if (editingTagsDoc) {
                    await fetch(`/api/rooms/${roomId}/documents/${editingTagsDoc.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ expiryAction: v }),
                    });
                    fetchDocuments();
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARCHIVE">Archive</SelectItem>
                  <SelectItem value="DELETE">Delete</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTagsDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingTagsDoc) {
                  const tags = tagInput
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                  handleSaveTags(editingTagsDoc, tags);
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Link Dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Share Link</DialogTitle>
            <DialogDescription>
              Create a link to share this room with external users.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="linkName">Link Name</Label>
              <Input
                id="linkName"
                placeholder="Investor Access"
                value={newLinkName}
                onChange={(e) => setNewLinkName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isCreatingLink) {
                    handleCreateLink();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkPermission">Permission Level</Label>
              <Select
                value={newLinkPermission}
                onValueChange={(value) => setNewLinkPermission(value as 'VIEW' | 'DOWNLOAD')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEW">View Only</SelectItem>
                  <SelectItem value="DOWNLOAD">View & Download</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkPassword">Password Protection (optional)</Label>
              <Input
                id="linkPassword"
                type="password"
                placeholder="Leave blank for no password"
                value={newLinkPassword}
                onChange={(e) => setNewLinkPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkExpiry">Expiration Date (optional)</Label>
              <Input
                id="linkExpiry"
                type="datetime-local"
                value={newLinkExpiry}
                onChange={(e) => setNewLinkExpiry(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkSessionLimit">Session Time Limit in Minutes (optional)</Label>
              <Input
                id="linkSessionLimit"
                type="number"
                min="1"
                placeholder="e.g. 60"
                value={newLinkSessionLimit}
                onChange={(e) => setNewLinkSessionLimit(e.target.value)}
              />
              <p className="text-xs text-neutral-500">
                Maximum viewing time per session. Leave blank for unlimited.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowLinkDialog(false);
                setNewLinkName('');
                setNewLinkPermission('VIEW');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateLink} disabled={isCreatingLink || !newLinkName.trim()}>
              {isCreatingLink ? 'Creating...' : 'Create Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Create a folder to organize documents in this data room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folderName">Folder Name</Label>
              <Input
                id="folderName"
                placeholder="Enter folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isCreatingFolder) {
                    handleCreateFolder();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFolderDialog(false);
                setNewFolderName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={isCreatingFolder || !newFolderName.trim()}
            >
              {isCreatingFolder ? 'Creating...' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Document Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedDocument?.name}&quot;? This document
              will be moved to trash and can be restored later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setSelectedDocument(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation Dialog */}
      <Dialog open={showFolderDeleteDialog} onOpenChange={setShowFolderDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedFolder?.name}&quot;? This will delete
              all documents and subfolders inside it. Documents will be moved to trash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFolderDeleteDialog(false);
                setSelectedFolder(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmFolderDelete} disabled={isDeletingFolder}>
              {isDeletingFolder ? 'Deleting...' : 'Delete Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{selectedDocument?.name}</DialogTitle>
          </DialogHeader>
          <div className="relative h-[70vh] overflow-auto">
            {room?.enableWatermark && (
              <WatermarkOverlay
                template={room.watermarkTemplate || undefined}
                viewerEmail={undefined}
                viewerName="Admin Preview"
                roomName={room.name}
              />
            )}
            {previewError ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <FileText className="mb-4 h-16 w-16 text-neutral-300" />
                <p className="mb-4 text-neutral-500">{previewError}</p>
                {selectedDocument && (
                  <Button onClick={() => handleDownload(selectedDocument)}>
                    <Download className="mr-2 h-4 w-4" />
                    Download Instead
                  </Button>
                )}
              </div>
            ) : previewUrl ? (
              selectedDocument?.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewUrl}
                  className="h-full w-full border-0"
                  title={selectedDocument?.name}
                />
              ) : selectedDocument?.mimeType.startsWith('image/') &&
                selectedDocument?.mimeType !== 'image/svg+xml' ? (
                <div className="flex h-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={selectedDocument?.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : selectedDocument?.mimeType.startsWith('text/') ||
                selectedDocument?.mimeType === 'application/json' ||
                selectedDocument?.mimeType === 'application/xml' ||
                selectedDocument?.mimeType === 'image/svg+xml' ? (
                <TextPreviewFetcher
                  url={previewUrl}
                  mimeType={selectedDocument?.mimeType ?? 'text/plain'}
                  fileName={selectedDocument?.name ?? 'file'}
                />
              ) : (
                <ConvertedPreview
                  url={previewUrl}
                  name={selectedDocument?.name ?? 'file'}
                  onDownload={() => selectedDocument && handleDownload(selectedDocument)}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
                  <p className="text-neutral-500">Loading preview...</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            {selectedDocument && (
              <Button variant="outline" onClick={() => handleDownload(selectedDocument)}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            )}
            <Button onClick={() => setShowPreviewDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog
        open={showVersionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowVersionDialog(false);
            setVersionDoc(null);
            setVersions([]);
            setVersionPreviewUrl(null);
            setVersionPreviewId(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </DialogTitle>
            <DialogDescription>
              {versionDoc?.name} — {versions.length} version{versions.length !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto">
            {isLoadingVersions ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                <span className="ml-2 text-neutral-500">Loading versions...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="py-8 text-center text-neutral-500">No versions found</div>
            ) : (
              <div className="space-y-2">
                {versions.map((v, i) => {
                  const isCurrent = i === 0;
                  const isClean = v.scanStatus === 'CLEAN';
                  const fileSizeKb = Number(v.fileSize) / 1024;
                  const fileSizeDisplay =
                    fileSizeKb > 1024
                      ? `${(fileSizeKb / 1024).toFixed(1)} MB`
                      : `${fileSizeKb.toFixed(0)} KB`;

                  return (
                    <div
                      key={v.id}
                      className={`rounded-lg border p-3 ${isCurrent ? 'border-primary-200 bg-primary-50/50' : 'bg-white'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">v{v.versionNumber}</span>
                            {isCurrent && (
                              <Badge variant="default" className="text-xs">
                                Current
                              </Badge>
                            )}
                            {v.scanStatus === 'INFECTED' && (
                              <Badge variant="danger" className="text-xs">
                                <AlertCircle className="mr-1 h-3 w-3" />
                                Infected
                              </Badge>
                            )}
                            {v.scanStatus === 'PENDING' && (
                              <Badge variant="secondary" className="text-xs">
                                Scanning...
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {v.uploadedByUser
                              ? `${v.uploadedByUser.firstName} ${v.uploadedByUser.lastName}`
                              : 'Unknown'}{' '}
                            — {new Date(v.createdAt).toLocaleString()}
                          </p>
                          <p className="text-xs text-neutral-400">
                            {v.fileName} · {fileSizeDisplay}
                          </p>
                          {v.changeDescription && (
                            <p className="mt-1 text-xs italic text-neutral-600">
                              {v.changeDescription}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isClean && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                if (versionPreviewId === v.id) {
                                  setVersionPreviewUrl(null);
                                  setVersionPreviewId(null);
                                } else {
                                  setVersionPreviewUrl(
                                    `/api/rooms/${roomId}/documents/${versionDoc!.id}/preview?versionId=${v.id}`
                                  );
                                  setVersionPreviewId(v.id);
                                }
                              }}
                            >
                              <Eye className="mr-1 h-3 w-3" />
                              {versionPreviewId === v.id ? 'Hide' : 'Preview'}
                            </Button>
                          )}
                          {!isCurrent && isClean && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={isRollingBack}
                              onClick={() => handleRollback(v.id, v.versionNumber)}
                            >
                              {isRollingBack ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1 h-3 w-3" />
                              )}
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Inline preview for selected version */}
                      {versionPreviewId === v.id && versionPreviewUrl && (
                        <div className="mt-3 overflow-hidden rounded-lg border bg-neutral-50">
                          <div className="h-64">
                            {v.mimeType === 'application/pdf' ? (
                              <iframe
                                src={versionPreviewUrl}
                                className="h-full w-full border-0"
                                title={`v${v.versionNumber} preview`}
                              />
                            ) : v.mimeType.startsWith('image/') ? (
                              <div className="flex h-full items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={versionPreviewUrl}
                                  alt={`v${v.versionNumber}`}
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center text-neutral-400">
                                <FileText className="mr-2 h-5 w-5" />
                                Preview loaded in new format
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <div>
              <input
                ref={versionFileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleUploadNewVersion(file);
                  }
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                onClick={() => versionFileRef.current?.click()}
                disabled={isUploadingVersion}
              >
                {isUploadingVersion ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Upload New Version
              </Button>
            </div>
            <Button onClick={() => setShowVersionDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteLinkTarget !== null}
        onOpenChange={(open) => !open && setDeleteLinkTarget(null)}
        title="Delete Share Link"
        description={`Are you sure you want to delete the link "${deleteLinkTarget?.name}"? External users will no longer be able to access this room via this link.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteLinkConfirm}
        loading={isDeletingLink}
      />

      <ConfirmDialog
        open={removeMemberTarget !== null}
        onOpenChange={(open) => !open && setRemoveMemberTarget(null)}
        title="Remove Room Admin"
        description={`Are you sure you want to remove ${removeMemberTarget?.firstName} ${removeMemberTarget?.lastName} as a room admin? They will lose access to manage this room.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemoveMemberConfirm}
        loading={isRemovingMember}
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

/**
 * Fetches a converted preview (e.g. PDF from Gotenberg) via blob URL.
 * Shows error UI if the server returns 404 or a JSON error response.
 */
function ConvertedPreview({
  url,
  name,
  onDownload,
}: {
  url: string;
  name: string;
  onDownload: () => void;
}) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(url)
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || ct.startsWith('application/json')) {
          setError(true);
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <FileText className="mb-4 h-16 w-16 text-neutral-300" />
        <p className="mb-4 text-neutral-500">Preview not available for this file type</p>
        <Button onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download Instead
        </Button>
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  return <iframe src={blobUrl} className="h-full w-full border-0" title={name} />;
}

/**
 * Fetches text content from a URL then renders via TextPreviewRenderer
 */
function TextPreviewFetcher({
  url,
  mimeType,
  fileName,
}: {
  url: string;
  mimeType: string;
  fileName: string;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to load');
        }
        // Belt-and-suspenders: if server returns JSON but we expected a text file, treat as error
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('application/json') && mimeType !== 'application/json') {
          throw new Error('Preview not available');
        }
        return res.text();
      })
      .then(setContent)
      .catch((err) => setError(err.message));
  }, [url, mimeType]);

  if (error) {
    return <div className="flex h-full items-center justify-center text-neutral-500">{error}</div>;
  }

  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  return <TextPreviewRenderer content={content} mimeType={mimeType} fileName={fileName} />;
}
