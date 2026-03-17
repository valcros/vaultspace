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
  MoreHorizontal,
  Download,
  Eye,
  Trash2,
  Copy,
  Mail,
  BarChart3,
  History,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [newFolderName, setNewFolderName] = React.useState('');
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);

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
      const response = await fetch(`/api/rooms/${roomId}/documents`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  }, [roomId]);

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
  }, [activeTab, room, fetchDocuments, fetchAdmins, fetchLinks, fetchActivity]);

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
        body: JSON.stringify({ name: newFolderName.trim() }),
      });

      if (response.ok) {
        setShowFolderDialog(false);
        setNewFolderName('');
        fetchDocuments(); // Refresh to show new folder
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
  }, [roomId, newFolderName, fetchDocuments]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-96 mb-8" />
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
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: room.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {room.status === 'ARCHIVED' && <Badge variant="secondary">Archived</Badge>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal className="w-4 h-4 mr-2" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/analytics`)}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Analytics
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/audit`)}>
                  <History className="w-4 h-4 mr-2" />
                  Audit Trail
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/rooms/${roomId}/trash`)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => router.push(`/rooms/${roomId}/settings`)}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="w-4 h-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2">
              <Users className="w-4 h-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="links" className="gap-2">
              <LinkIcon className="w-4 h-4" />
              Share Links
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <Activity className="w-4 h-4" />
              Activity
            </TabsTrigger>
          </TabsList>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Button onClick={() => setShowUploadDialog(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Files
                </Button>
                <Button variant="outline" onClick={() => setShowFolderDialog(true)}>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  New Folder
                </Button>
              </div>
            </div>

            {documents.length === 0 ? (
              <Card className="p-12 text-center">
                <FileText className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-semibold text-neutral-900 mb-2">No documents yet</h3>
                <p className="text-neutral-500 mb-6 max-w-sm mx-auto">
                  Upload your first documents to start sharing them securely.
                </p>
                <Button onClick={() => setShowUploadDialog(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Files
                </Button>
              </Card>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-neutral-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
                        Name
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
                        Size
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
                        Uploaded
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className="border-b last:border-0 hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-neutral-400" />
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
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="w-4 h-4 mr-2" />
                                Preview
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Download className="w-4 h-4 mr-2" />
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-danger-600">
                                <Trash2 className="w-4 h-4 mr-2" />
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
            <div className="flex items-center justify-between mb-6">
              <Button onClick={() => setShowMemberDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Admin
              </Button>
            </div>

            {admins.length === 0 ? (
              <Card className="p-12 text-center">
                <Users className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-semibold text-neutral-900 mb-2">No admins yet</h3>
                <p className="text-neutral-500 mb-6 max-w-sm mx-auto">
                  Add team members to collaborate on this data room.
                </p>
                <Button onClick={() => setShowMemberDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Admin
                </Button>
              </Card>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-neutral-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
                        Admin
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-neutral-500">
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
                                  <Trash2 className="w-4 h-4 mr-2" />
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
            <div className="flex items-center justify-between mb-6">
              <Button onClick={() => setShowLinkDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Link
              </Button>
            </div>

            {links.length === 0 ? (
              <Card className="p-12 text-center">
                <LinkIcon className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-semibold text-neutral-900 mb-2">No share links yet</h3>
                <p className="text-neutral-500 mb-6 max-w-sm mx-auto">
                  Create share links to give external users access to this room.
                </p>
                <Button onClick={() => setShowLinkDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
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
                          <CardDescription className="flex items-center gap-2 mt-1">
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
                              <Copy className="w-4 h-4 mr-2" />
                              Copy Link
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="w-4 h-4 mr-2" />
                              Send via Email
                            </DropdownMenuItem>
                            <DropdownMenuItem>Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-danger-600">
                              <Trash2 className="w-4 h-4 mr-2" />
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
                        <div>
                          Created {formatDate(link.createdAt)}
                        </div>
                        {link.expiresAt && (
                          <div>
                            Expires {formatDate(link.expiresAt)}
                          </div>
                        )}
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
                <Activity className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-semibold text-neutral-900 mb-2">No activity yet</h3>
                <p className="text-neutral-500 max-w-sm mx-auto">
                  Activity will appear here as users interact with this room.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {activity.map((event) => (
                  <div key={event.id} className="flex items-start gap-4 py-3 border-b last:border-0">
                    <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                      <Activity className="w-4 h-4 text-neutral-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">
                          {event.actor
                            ? `${event.actor.firstName} ${event.actor.lastName}`
                            : 'System'}
                        </span>{' '}
                        <span className="text-neutral-500">{event.type.replace(/_/g, ' ').toLowerCase()}</span>
                      </p>
                      <p className="text-xs text-neutral-400 mt-1">
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
            <DialogDescription>
              Add a team member to this data room.
            </DialogDescription>
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
            <Button>Add Member</Button>
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
            <Button>Create Link</Button>
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
            <Button onClick={handleCreateFolder} disabled={isCreatingFolder || !newFolderName.trim()}>
              {isCreatingFolder ? 'Creating...' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
