'use client';

import * as React from 'react';
import {
  Search,
  MoreHorizontal,
  Mail,
  Shield,
  Eye,
  Trash2,
  UserPlus,
  Link2,
  Pencil,
  KeyRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { useRequireAdmin } from '@/components/layout/role-provider';
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'ADMIN' | 'VIEWER';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: 'ADMIN' | 'VIEWER';
  createdAt: string;
  expiresAt: string;
}

interface ViewerLinkInvite {
  id: string;
  email: string;
  inviteeName: string | null;
  inviteeCompany: string | null;
  roomId: string | null;
  roomName: string | null;
  invitedBy: string | null;
  status: 'pending' | 'opened';
  emailSent: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export default function UsersPage() {
  useRequireAdmin();
  const { toast } = useToast();
  const [users, setUsers] = React.useState<User[]>([]);
  const [pendingInvites, setPendingInvites] = React.useState<PendingInvite[]>([]);
  const [viewerLinkInvites, setViewerLinkInvites] = React.useState<ViewerLinkInvite[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showInviteDialog, setShowInviteDialog] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isInviting, setIsInviting] = React.useState(false);
  const [inviteData, setInviteData] = React.useState<{ email: string; role: 'ADMIN' | 'VIEWER' }>({
    email: '',
    role: 'VIEWER',
  });
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  // Compose-email dialog: sends via the VaultSpace platform (org sender), not
  // the local mail client.
  const [emailTarget, setEmailTarget] = React.useState<User | null>(null);
  const [emailSubject, setEmailSubject] = React.useState('');
  const [emailBody, setEmailBody] = React.useState('');
  const [isSendingEmail, setIsSendingEmail] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  // Edit-user dialog.
  const [editTarget, setEditTarget] = React.useState<User | null>(null);
  const [editData, setEditData] = React.useState<{
    firstName: string;
    lastName: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
    isActive: boolean;
  }>({ firstName: '', lastName: '', email: '', role: 'VIEWER', isActive: true });
  const [isSavingEdit, setIsSavingEdit] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(data.users || []);
        setPendingInvites(data.pendingInvitations || []);
        setViewerLinkInvites(data.viewerLinkInvites || []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteData.email.trim()) {
      return;
    }

    setIsInviting(true);
    setInviteError(null);
    try {
      const response = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteData),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        setShowInviteDialog(false);
        setInviteData({ email: '', role: 'VIEWER' });
        setInviteError(null);
        fetchUsers();
      } else {
        setInviteError(data.error || 'Failed to send invitation');
      }
    } catch (error) {
      console.error('Failed to invite user:', error);
      setInviteError('Network error. Please try again.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailTarget || !emailSubject.trim() || !emailBody.trim()) {
      setEmailError('Subject and message are required.');
      return;
    }
    setIsSendingEmail(true);
    setEmailError(null);
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: emailTarget.email,
          subject: emailSubject,
          body: emailBody,
        }),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setEmailTarget(null);
        setEmailSubject('');
        setEmailBody('');
      } else {
        setEmailError(data.error || 'Failed to send email');
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      setEmailError('Network error. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const openEditDialog = (user: User) => {
    setEditTarget(user);
    setEditData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) {
      return;
    }
    if (!editData.firstName.trim() || !editData.lastName.trim() || !editData.email.trim()) {
      setEditError('First name, last name, and email are required.');
      return;
    }
    // Send only fields the admin actually changed. The status shown here is the
    // combined membership+account flag, so blindly resending isActive could
    // deactivate a membership on an unrelated name edit; only include it (and the
    // other fields) when it differs from the loaded value.
    const payload: {
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: 'ADMIN' | 'VIEWER';
      isActive?: boolean;
    } = {};
    if (editData.firstName !== editTarget.firstName) {
      payload.firstName = editData.firstName;
    }
    if (editData.lastName !== editTarget.lastName) {
      payload.lastName = editData.lastName;
    }
    if (editData.email !== editTarget.email) {
      payload.email = editData.email;
    }
    if (editData.role !== editTarget.role) {
      payload.role = editData.role;
    }
    if (editData.isActive !== editTarget.isActive) {
      payload.isActive = editData.isActive;
    }
    if (Object.keys(payload).length === 0) {
      setEditTarget(null);
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/users/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setEditTarget(null);
        if (data.selfSessionInvalidated) {
          // Editing your own email/role/status signs you out; re-authenticate
          // rather than showing a stale shell that will fail on the next action.
          window.location.href = '/auth/login';
          return;
        }
        fetchUsers();
      } else {
        setEditError(data.error || 'Failed to update user');
      }
    } catch (error) {
      console.error('Failed to update user:', error);
      setEditError('Network error. Please try again.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string | null) => {
    if (!dateString) {
      return 'Never';
    }
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage organization members and their access"
        actions={
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite User
          </Button>
        }
      />

      <AdminPageContent>
        <AdminToolbar
          title="Team directory"
          description="Search members, review roles, and invite collaborators without leaving the page."
          actions={
            <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {filteredUsers.length} visible
            </div>
          }
        >
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </AdminToolbar>

        {/* Users Table */}
        {isLoading ? (
          <AdminSurface className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-xl border border-slate-200/80 p-4 dark:border-slate-800"
              >
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              </div>
            ))}
          </AdminSurface>
        ) : users.length === 0 ? (
          <AdminEmptyState
            icon={<UserPlus className="h-6 w-6" />}
            title="No users yet"
            description="Invite team members to collaborate in your data rooms and keep access tightly controlled from one place."
            action={
              <Button onClick={() => setShowInviteDialog(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite your first user
              </Button>
            }
          />
        ) : (
          <AdminSurface className="overflow-hidden p-0">
            <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
              <p className="text-xs font-medium text-primary-600 dark:text-primary-400">
                Organization Access
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                Members and roles
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      User
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Role
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Last Active
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Joined
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-slate-200/70 transition-colors last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/40"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                          <div>
                            <div className="flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                              {user.firstName} {user.lastName}
                              {!user.isActive && (
                                <Badge variant="secondary" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
                          {user.role === 'ADMIN' ? (
                            <Shield className="mr-1 h-3 w-3" />
                          ) : (
                            <Eye className="mr-1 h-3 w-3" />
                          )}
                          {user.role.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(user.lastLoginAt)}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              aria-label="Actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(user)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEmailTarget(user);
                                setEmailSubject('');
                                setEmailBody('');
                                setEmailError(null);
                              }}
                            >
                              <Mail className="mr-2 h-4 w-4" />
                              Send Email
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                const newRole = user.role === 'ADMIN' ? 'VIEWER' : 'ADMIN';
                                setConfirmAction({
                                  title: 'Change Role',
                                  description: `Change ${user.firstName} ${user.lastName}'s role to ${newRole.toLowerCase()}?`,
                                  onConfirm: async () => {
                                    try {
                                      const res = await fetch(`/api/users/${user.id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ role: newRole }),
                                        credentials: 'include',
                                      });
                                      if (res.ok) {
                                        const data = await res.json().catch(() => ({}));
                                        if (data.selfSessionInvalidated) {
                                          // Demoting yourself ends your session;
                                          // re-authenticate instead of staying on a
                                          // stale admin shell.
                                          window.location.href = '/auth/login';
                                          return;
                                        }
                                        fetchUsers();
                                      }
                                    } catch (err) {
                                      console.error('Failed to change role:', err);
                                    }
                                  },
                                });
                              }}
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Change to {user.role === 'ADMIN' ? 'Viewer' : 'Admin'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setConfirmAction({
                                  title: 'Reset Password',
                                  description: `Send a password reset email to ${user.email}? They set a new password themselves; you never see it.`,
                                  onConfirm: async () => {
                                    try {
                                      const res = await fetch(
                                        `/api/users/${user.id}/reset-password`,
                                        { method: 'POST', credentials: 'include' }
                                      );
                                      if (res.ok) {
                                        toast({
                                          title: 'Password reset sent',
                                          description: `A reset email was sent to ${user.email}.`,
                                        });
                                      } else {
                                        const data = await res.json().catch(() => ({}));
                                        toast({
                                          title: 'Could not send reset',
                                          description: data.error || 'Please try again.',
                                          variant: 'destructive',
                                        });
                                      }
                                    } catch (err) {
                                      console.error('Failed to send password reset:', err);
                                      toast({
                                        title: 'Could not send reset',
                                        description: 'Please try again.',
                                        variant: 'destructive',
                                      });
                                    }
                                  },
                                });
                              }}
                            >
                              <KeyRound className="mr-2 h-4 w-4" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger-600"
                              onClick={() => {
                                setConfirmAction({
                                  title: 'Remove User',
                                  description: `Remove ${user.firstName} ${user.lastName} from the organization? This cannot be undone.`,
                                  onConfirm: async () => {
                                    try {
                                      const res = await fetch(`/api/users/${user.id}`, {
                                        method: 'DELETE',
                                        credentials: 'include',
                                      });
                                      if (res.ok) {
                                        fetchUsers();
                                      }
                                    } catch (err) {
                                      console.error('Failed to remove user:', err);
                                    }
                                  },
                                });
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {pendingInvites
                    .filter((inv) => inv.email.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((inv) => (
                      <tr
                        key={`invite-${inv.id}`}
                        className="border-b border-slate-200/70 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={inv.email} size="sm" />
                            <div>
                              <div className="flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                                {inv.email}
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400"
                                >
                                  Pending Invite
                                </Badge>
                              </div>
                              <div className="text-sm text-slate-500 dark:text-slate-400">
                                Awaiting registration
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={inv.role === 'ADMIN' ? 'default' : 'secondary'}>
                            {inv.role === 'ADMIN' ? (
                              <Shield className="mr-1 h-3 w-3" />
                            ) : (
                              <Eye className="mr-1 h-3 w-3" />
                            )}
                            {inv.role.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">—</td>
                        <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                          Invited {formatDate(inv.createdAt)}
                        </td>
                        <td className="px-5 py-4"></td>
                      </tr>
                    ))}
                  {viewerLinkInvites
                    .filter(
                      (vl) =>
                        vl.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (vl.inviteeName ?? '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((vl) => {
                      const displayName = vl.inviteeName || vl.email;
                      const subtitle = vl.roomName
                        ? `${vl.inviteeCompany ? vl.inviteeCompany + ' · ' : ''}${vl.roomName}`
                        : (vl.inviteeCompany ?? 'Data room viewer');
                      return (
                        <tr
                          key={`viewer-link-${vl.id}`}
                          className="border-b border-slate-200/70 last:border-0 dark:border-slate-800"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <UserAvatar name={displayName} size="sm" />
                              <div>
                                <div className="flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                                  {displayName}
                                  <Badge
                                    variant="outline"
                                    className="border-blue-300 text-xs text-blue-700 dark:border-blue-700 dark:text-blue-400"
                                  >
                                    <Link2 className="mr-1 h-3 w-3" />
                                    {vl.status === 'opened' ? 'Viewed' : 'Pending Viewer'}
                                  </Badge>
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                  {vl.email !== displayName && (
                                    <span className="mr-2">{vl.email}</span>
                                  )}
                                  {subtitle}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <Badge variant="secondary">
                              <Eye className="mr-1 h-3 w-3" />
                              viewer link
                            </Badge>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">
                            —
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                            Invited {formatDate(vl.createdAt)}
                          </td>
                          <td className="px-5 py-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              aria-label="Go to room"
                              onClick={() => {
                                if (vl.roomId) {
                                  window.location.href = `/rooms/${vl.roomId}?manage=links`;
                                }
                              }}
                              disabled={!vl.roomId}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </AdminSurface>
        )}
      </AdminPageContent>

      {/* Edit User Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update this member&apos;s details, role, and status. Changing email, role, or status
              signs the user out of any active sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {editError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-first">First name</Label>
                <Input
                  id="edit-first"
                  value={editData.firstName}
                  onChange={(e) => {
                    setEditData({ ...editData, firstName: e.target.value });
                    setEditError(null);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-last">Last name</Label>
                <Input
                  id="edit-last"
                  value={editData.lastName}
                  onChange={(e) => {
                    setEditData({ ...editData, lastName: e.target.value });
                    setEditError(null);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editData.email}
                onChange={(e) => {
                  setEditData({ ...editData, email: e.target.value });
                  setEditError(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={editData.role}
                onValueChange={(value) =>
                  setEditData({ ...editData, role: value as 'ADMIN' | 'VIEWER' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Admin
                    </div>
                  </SelectItem>
                  <SelectItem value="VIEWER">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Viewer
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={editData.isActive ? 'active' : 'inactive'}
                onValueChange={(value) =>
                  setEditData({ ...editData, isActive: value === 'active' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} loading={isSavingEdit}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Email (platform message) Dialog */}
      <Dialog
        open={emailTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEmailTarget(null);
            setEmailError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Email</DialogTitle>
            <DialogDescription>
              Sent from your organization&apos;s address via VaultSpace
              {emailTarget ? ` to ${emailTarget.email}` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {emailError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {emailError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => {
                  setEmailSubject(e.target.value);
                  setEmailError(null);
                }}
                placeholder="Subject"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-body">Message</Label>
              <textarea
                id="email-body"
                value={emailBody}
                onChange={(e) => {
                  setEmailBody(e.target.value);
                  setEmailError(null);
                }}
                rows={6}
                placeholder="Write your message…"
                className="border-input focus-visible:ring-ring flex min-h-[120px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              loading={isSendingEmail}
              disabled={!emailSubject.trim() || !emailBody.trim()}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog
        open={showInviteDialog}
        onOpenChange={(open) => {
          setShowInviteDialog(open);
          if (!open) {
            setInviteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an invitation email to add a new team member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {inviteError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {inviteError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteData.email}
                onChange={(e) => {
                  setInviteData({ ...inviteData, email: e.target.value });
                  setInviteError(null);
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={inviteData.role}
                onValueChange={(value) =>
                  setInviteData({ ...inviteData, role: value as 'ADMIN' | 'VIEWER' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Admin - Full access to all rooms and settings
                    </div>
                  </SelectItem>
                  <SelectItem value="VIEWER">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Viewer - View access to assigned rooms
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} loading={isInviting} disabled={!inviteData.email.trim()}>
              Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description ?? ''}
        confirmLabel={confirmAction?.title === 'Remove User' ? 'Remove' : 'Confirm'}
        variant={confirmAction?.title === 'Remove User' ? 'destructive' : 'default'}
        onConfirm={async () => {
          if (confirmAction) {
            await confirmAction.onConfirm();
            setConfirmAction(null);
          }
        }}
      />
    </>
  );
}
