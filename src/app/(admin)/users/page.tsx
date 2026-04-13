'use client';

import * as React from 'react';
import { Search, MoreHorizontal, Mail, Shield, Eye, Trash2, UserPlus } from 'lucide-react';

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
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

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

export default function UsersPage() {
  const [users, setUsers] = React.useState<User[]>([]);
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
                            <DropdownMenuItem
                              onClick={() => {
                                window.location.href = `mailto:${user.email}`;
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
                </tbody>
              </table>
            </div>
          </AdminSurface>
        )}
      </AdminPageContent>

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
