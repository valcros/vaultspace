'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  Users,
  Link as LinkIcon,
  Activity,
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
  Mail,
  BarChart3,
  History,
  ChevronRight,
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
import { UploadZone } from '@/components/documents/UploadZone';

interface Room {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  watermarkEnabled: boolean;
  downloadEnabled: boolean;
  createdAt: string;
}

interface Document {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  uploadedBy: { firstName: string; lastName: string };
  createdAt: string;
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

interface ShareLink {
  id: string;
  name: string;
  token: string;
  accessType: 'PUBLIC' | 'EMAIL_REQUIRED' | 'PASSWORD_PROTECTED';
  viewCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  actor: { firstName: string; lastName: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
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
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState('documents');

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
      const url = currentFolderId
        ? `/api/rooms/${roomId}/documents?folderId=${currentFolderId}`
        : `/api/rooms/${roomId}/documents`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  }, [roomId, currentFolderId]);

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

  const fetchActivity = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/audit`);
      if (response.ok) {
        const data = await response.json();
        setActivity(data.events || []);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    }
  }, [roomId]);

  React.useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  React.useEffect(() => {
    if (room) {
      switch (activeTab) {
        case 'documents':
          fetchDocuments();
          fetchFolders();
          break;
        case 'members':
          fetchAdmins();
          break;
        case 'links':
          fetchLinks();
          break;
        case 'activity':
          fetchActivity();
          break;
      }
    }
  }, [activeTab, room, fetchDocuments, fetchFolders, fetchAdmins, fetchLinks, fetchActivity]);

  // Refetch when navigating folders
  React.useEffect(() => {
    if (room && activeTab === 'documents') {
      fetchDocuments();
      fetchFolders();
    }
  }, [currentFolderId, room, activeTab, fetchDocuments, fetchFolders]);

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
    (results: Array<{ documentId: string; name: string }>) => {
      console.log('Upload complete:', results);
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
        alert(error.error?.message || 'Failed to create folder');
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder');
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
        const response = await fetch(
          `/api/rooms/${roomId}/documents/${doc.id}/download`
        );
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
        alert('Failed to download document');
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

      // For PDFs and images, we can preview directly
      const previewableTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ];

      if (previewableTypes.includes(doc.mimeType)) {
        setPreviewUrl(`/api/rooms/${roomId}/documents/${doc.id}/preview`);
      } else {
        setPreviewError('Preview not available for this file type. Use download instead.');
      }
    },
    [roomId]
  );

  // Handle document delete
  const handleDelete = React.useCallback(
    async (doc: Document) => {
      setSelectedDocument(doc);
      setShowDeleteDialog(true);
    },
    []
  );

  // Confirm delete
  const confirmDelete = React.useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(
        `/api/rooms/${roomId}/documents/${selectedDocument.id}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setShowDeleteDialog(false);
        setSelectedDocument(null);
        fetchDocuments(); // Refresh the list
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete document');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  }, [roomId, selectedDocument, fetchDocuments]);

  if (isLoading) {
    return (
      <div className="p-6">
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
      <PageHeader
        title={room.name}
        description={room.description || 'No description'}
        breadcrumbs={[{ label: 'Rooms', href: '/rooms' }, { label: room.name }]}
        actions={
          <div className="flex items-center gap-2">
            {room.status === 'ARCHIVED' && <Badge variant="secondary">Archived</Badge>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal className="mr-2 h-4 w-4" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => router.push(`/rooms/${roomId}/settings`)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="links" className="gap-2">
              <LinkIcon className="h-4 w-4" />
              Share Links
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <Activity className="h-4 w-4" />
              Activity
            </TabsTrigger>
          </TabsList>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-6">
            {/* Breadcrumb navigation */}
            {breadcrumbs.length > 1 && (
              <div className="mb-4 flex items-center gap-1 text-sm">
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.id ?? 'root'}>
                    {index > 0 && <ChevronRight className="h-4 w-4 text-neutral-400" />}
                    <button
                      onClick={() => handleBreadcrumbClick(index)}
                      className={`rounded px-2 py-1 hover:bg-neutral-100 ${
                        index === breadcrumbs.length - 1
                          ? 'font-medium text-neutral-900'
                          : 'text-neutral-500 hover:text-neutral-900'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button onClick={() => setShowUploadDialog(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Files
                </Button>
                <Button variant="outline" onClick={() => setShowFolderDialog(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Folder
                </Button>
              </div>
            </div>

            {folders.length === 0 && documents.length === 0 ? (
              <Card className="p-12 text-center">
                <FileText className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No documents yet</h3>
                <p className="mx-auto mb-6 max-w-sm text-neutral-500">
                  Upload your first documents to start sharing them securely.
                </p>
                <Button onClick={() => setShowUploadDialog(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Files
                </Button>
              </Card>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="border-b bg-neutral-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Size
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Uploaded
                      </th>
                      <th className="w-10"></th>
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
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Folder className="h-5 w-5 text-yellow-500" />
                            <span className="font-medium">{folder.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-500">
                          {folder.documentCount} files, {folder.childCount} folders
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">folder</Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-500">
                          {formatDate(folder.createdAt)}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleFolderClick(folder)}>
                                <Eye className="mr-2 h-4 w-4" />
                                Open
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled className="text-neutral-400">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete (Coming soon)
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                    {/* Render documents */}
                    {documents.map((doc) => (
                      <tr
                        key={doc.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-neutral-50"
                        onClick={() => handlePreview(doc)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-neutral-400" />
                            <span className="font-medium">{doc.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-500">
                          {formatFileSize(doc.size)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              doc.status === 'READY'
                                ? 'success'
                                : doc.status === 'FAILED'
                                  ? 'danger'
                                  : 'secondary'
                            }
                          >
                            {doc.status.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-500">
                          {formatDate(doc.createdAt)}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
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
              </div>
            )}
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members" className="mt-6">
            <div className="mb-6 flex items-center justify-between">
              <Button onClick={() => setShowMemberDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Admin
              </Button>
            </div>

            {admins.length === 0 ? (
              <Card className="p-12 text-center">
                <Users className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No admins yet</h3>
                <p className="mx-auto mb-6 max-w-sm text-neutral-500">
                  Add team members to collaborate on this data room.
                </p>
                <Button onClick={() => setShowMemberDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Admin
                </Button>
              </Card>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="border-b bg-neutral-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Admin
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-neutral-500">
                        Scope
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin) => (
                      <tr key={admin.id} className="border-b last:border-0 hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={`${admin.firstName} ${admin.lastName}`} size="sm" />
                            <div>
                              <div className="font-medium">
                                {admin.firstName} {admin.lastName}
                              </div>
                              <div className="text-sm text-neutral-500">{admin.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={admin.scope === 'organization' ? 'default' : 'secondary'}>
                            {admin.scope === 'organization' ? 'Org Admin' : 'Room Admin'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {admin.scope === 'room' && (
                                <DropdownMenuItem className="text-danger-600">
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
              </div>
            )}
          </TabsContent>

          {/* Links Tab */}
          <TabsContent value="links" className="mt-6">
            <div className="mb-6 flex items-center justify-between">
              <Button onClick={() => setShowLinkDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Link
              </Button>
            </div>

            {links.length === 0 ? (
              <Card className="p-12 text-center">
                <LinkIcon className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No share links yet</h3>
                <p className="mx-auto mb-6 max-w-sm text-neutral-500">
                  Create share links to give external users access to this room.
                </p>
                <Button onClick={() => setShowLinkDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Link
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {links.map((link) => (
                  <Card key={link.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{link.name}</CardTitle>
                          <CardDescription className="mt-1 flex items-center gap-2">
                            <Badge
                              variant={
                                link.accessType === 'PUBLIC'
                                  ? 'warning'
                                  : link.accessType === 'PASSWORD_PROTECTED'
                                    ? 'default'
                                    : 'secondary'
                              }
                            >
                              {link.accessType.replace('_', ' ').toLowerCase()}
                            </Badge>
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
                            <DropdownMenuItem>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy Link
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="mr-2 h-4 w-4" />
                              Send via Email
                            </DropdownMenuItem>
                            <DropdownMenuItem>Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-danger-600">
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
                          <span className="font-medium text-neutral-900">{link.viewCount}</span>{' '}
                          views
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

          {/* Activity Tab */}
          <TabsContent value="activity" className="mt-6">
            {activity.length === 0 ? (
              <Card className="p-12 text-center">
                <Activity className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No activity yet</h3>
                <p className="mx-auto max-w-sm text-neutral-500">
                  Activity will appear here as users interact with this room.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {activity.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-4 border-b py-3 last:border-0"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100">
                      <Activity className="h-4 w-4 text-neutral-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          {event.actor
                            ? `${event.actor.firstName} ${event.actor.lastName}`
                            : 'System'}
                        </span>{' '}
                        <span className="text-neutral-500">
                          {event.type.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

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
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>Add a team member to this data room.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="memberEmail">Email Address</Label>
              <Input id="memberEmail" type="email" placeholder="member@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memberRole">Role</Label>
              <Select defaultValue="VIEWER">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMemberDialog(false)}>
              Cancel
            </Button>
            <Button disabled title="Coming soon">
              Add Member (Coming soon)
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
              <Input id="linkName" placeholder="Investor Access" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accessType">Access Type</Label>
              <Select defaultValue="EMAIL_REQUIRED">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public (anyone with link)</SelectItem>
                  <SelectItem value="EMAIL_REQUIRED">Email Required</SelectItem>
                  <SelectItem value="PASSWORD_PROTECTED">Password Protected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>
              Cancel
            </Button>
            <Button disabled title="Coming soon">
              Create Link (Coming soon)
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

      {/* Delete Confirmation Dialog */}
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
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
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
          <div className="h-[70vh] overflow-auto">
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
              ) : selectedDocument?.mimeType.startsWith('image/') ? (
                <div className="flex h-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={selectedDocument?.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  src={previewUrl}
                  className="h-full w-full border-0"
                  title={selectedDocument?.name}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600 mx-auto" />
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
    </>
  );
}
