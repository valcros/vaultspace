'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Users,
  Link as LinkIcon,
  Settings,
  Plus,
  MoreHorizontal,
  Eye,
  Trash2,
  Copy,
  BarChart3,
  History,
  Loader2,
  MessageSquare,
  ClipboardCheck,
  CalendarDays,
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
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AdminEmptyState, AdminSurface } from '@/components/layout/admin-page';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { AddMemberDialog } from './AddMemberDialog';
import { CreateLinkDialog, type CreateLinkValues } from './CreateLinkDialog';
import { DeleteLinkConfirmDialog } from './DeleteLinkConfirmDialog';
import { RemoveMemberConfirmDialog } from './RemoveMemberConfirmDialog';

// Manage-drawer panes only render on user action; ~2,000 lines of tab code
// stay out of the initial room chunk.
const paneLoading = () => (
  <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">Loading…</div>
);
const QATab = dynamic(() => import('@/components/rooms/QATab').then((m) => m.QATab), {
  loading: paneLoading,
  ssr: false,
});
const ChecklistTab = dynamic(
  () => import('@/components/rooms/ChecklistTab').then((m) => m.ChecklistTab),
  { loading: paneLoading, ssr: false }
);
const CalendarTab = dynamic(
  () => import('@/components/rooms/CalendarTab').then((m) => m.CalendarTab),
  { loading: paneLoading, ssr: false }
);

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

export const MANAGE_PANES = ['members', 'links', 'qa', 'checklist', 'calendar'] as const;
export type ManagePane = (typeof MANAGE_PANES)[number];

export function isManagePane(value: string | null): value is ManagePane {
  return value !== null && (MANAGE_PANES as readonly string[]).includes(value);
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export interface ManageDrawerProps {
  roomId: string;
  /** The loaded room; pane data fetching waits until it is non-null. */
  room: { id: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pane: ManagePane;
  onPaneChange: (pane: ManagePane) => void;
}

export function ManageDrawer({
  roomId,
  room,
  open,
  onOpenChange,
  pane,
  onPaneChange,
}: ManageDrawerProps) {
  const router = useRouter();

  const [admins, setAdmins] = React.useState<Admin[]>([]);
  const [links, setLinks] = React.useState<ShareLink[]>([]);

  // Dialog states
  const [showMemberDialog, setShowMemberDialog] = React.useState(false);
  const [showLinkDialog, setShowLinkDialog] = React.useState(false);

  // Link create states
  const [isCreatingLink, setIsCreatingLink] = React.useState(false);

  // Confirmation dialog states
  const [deleteLinkTarget, setDeleteLinkTarget] = React.useState<ShareLink | null>(null);
  const [isDeletingLink, setIsDeletingLink] = React.useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = React.useState<Admin | null>(null);
  const [isRemovingMember, setIsRemovingMember] = React.useState(false);

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
  const [isAddingMember, setIsAddingMember] = React.useState(false);

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

  // Lazy-load the manage drawer's pane data only when it opens or the user
  // switches panes. Q&A / Checklist / Calendar sub-components own their own
  // data fetching; the drawer only fetches the panes whose state lives here.
  React.useEffect(() => {
    if (!open || !room) {
      return;
    }
    if (pane === 'members') {
      fetchAdmins();
      fetchAccessRequests();
      fetchViewers();
    } else if (pane === 'links') {
      fetchLinks();
    }
  }, [open, pane, room, fetchAdmins, fetchAccessRequests, fetchViewers, fetchLinks]);

  // Handle share link creation
  const handleCreateLink = React.useCallback(
    async (values: CreateLinkValues) => {
      if (!values.name.trim()) {
        toast({ title: 'Required', description: 'Please enter a link name' });
        return false;
      }

      setIsCreatingLink(true);
      let created = false;
      try {
        const response = await fetch(`/api/rooms/${roomId}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.name.trim(),
            permission: values.permission,
            scope: 'ENTIRE_ROOM',
            ...(values.password && { password: values.password }),
            ...(values.expiry && { expiresAt: new Date(values.expiry).toISOString() }),
            ...(values.sessionLimit && { maxSessionMinutes: parseInt(values.sessionLimit, 10) }),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          created = true;
          setShowLinkDialog(false);
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
      return created;
    },
    [roomId, fetchLinks]
  );

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
  const handleAddMember = React.useCallback(
    async (email: string) => {
      if (!email.trim()) {
        toast({ title: 'Required', description: 'Please enter an email address' });
        return false;
      }

      setIsAddingMember(true);
      try {
        const response = await fetch(`/api/rooms/${roomId}/admins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
          }),
        });

        if (response.ok) {
          setShowMemberDialog(false);
          fetchAdmins();
          toast({ title: 'Success', description: 'Admin added successfully!', variant: 'success' });
          return true;
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
      return false;
    },
    [roomId, fetchAdmins]
  );

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

  return (
    <>
      {/* Manage Room drawer. Holds the secondary room surfaces (Access,
          Share Links, Q&A, Checklist, Calendar) so the page canvas can stay
          documents-first. Heavier admin surfaces (Settings, Audit,
          Analytics, Trash) remain dedicated routes accessible from the
          PageHeader More menu, not crammed into the drawer. */}
      <Sheet open={open} onOpenChange={onOpenChange}>
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
              value={pane}
              onValueChange={(v) => onPaneChange(v as ManagePane)}
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
                              <p className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
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
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      aria-label={`Actions for ${admin.firstName} ${admin.lastName}`}
                                    >
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

      {/* Add Member Dialog */}
      <AddMemberDialog
        open={showMemberDialog}
        onOpenChange={setShowMemberDialog}
        onAdd={handleAddMember}
        isAdding={isAddingMember}
      />

      {/* Create Link Dialog */}
      <CreateLinkDialog
        open={showLinkDialog}
        onOpenChange={setShowLinkDialog}
        onCreate={handleCreateLink}
        isCreating={isCreatingLink}
      />

      <DeleteLinkConfirmDialog
        open={deleteLinkTarget !== null}
        linkName={deleteLinkTarget?.name}
        onCancel={() => setDeleteLinkTarget(null)}
        onConfirm={handleDeleteLinkConfirm}
        loading={isDeletingLink}
      />

      <RemoveMemberConfirmDialog
        open={removeMemberTarget !== null}
        firstName={removeMemberTarget?.firstName}
        lastName={removeMemberTarget?.lastName}
        onCancel={() => setRemoveMemberTarget(null)}
        onConfirm={handleRemoveMemberConfirm}
        loading={isRemovingMember}
      />
    </>
  );
}
