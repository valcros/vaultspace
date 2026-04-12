'use client';

import * as React from 'react';
import { Plus, Search, MoreHorizontal, Users, Trash2, Edit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardContent, CardHeader } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Group {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export default function GroupsPage() {
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [newGroup, setNewGroup] = React.useState({ name: '', description: '' });
  const [editingGroup, setEditingGroup] = React.useState<Group | null>(null);
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [isSavingEdit, setIsSavingEdit] = React.useState(false);
  const [editForm, setEditForm] = React.useState({ name: '', description: '' });
  const [showMembersDialog, setShowMembersDialog] = React.useState(false);
  const [membersGroupId, setMembersGroupId] = React.useState<string | null>(null);
  const [members, setMembers] = React.useState<
    Array<{ id: string; firstName: string; lastName: string; email: string }>
  >([]);
  const [allUsers, setAllUsers] = React.useState<
    Array<{ id: string; firstName: string; lastName: string; email: string }>
  >([]);
  const [isLoadingMembers, setIsLoadingMembers] = React.useState(false);
  const [deleteGroup, setDeleteGroup] = React.useState<Group | null>(null);

  React.useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/users/groups');
      const data = await response.json();
      if (response.ok) {
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroup.name.trim()) {
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/users/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGroup),
      });

      if (response.ok) {
        setShowCreateDialog(false);
        setNewGroup({ name: '', description: '' });
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to create group:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditGroup = (group: Group) => {
    setEditingGroup(group);
    setEditForm({ name: group.name, description: group.description || '' });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingGroup || !editForm.name.trim()) {
      return;
    }
    setIsSavingEdit(true);
    try {
      const response = await fetch(`/api/users/groups/${editingGroup.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (response.ok) {
        setShowEditDialog(false);
        setEditingGroup(null);
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to update group:', error);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteGroup = async (group: Group) => {
    try {
      const response = await fetch(`/api/users/groups/${group.id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
    }
  };

  const handleManageMembers = async (groupId: string) => {
    setMembersGroupId(groupId);
    setShowMembersDialog(true);
    setIsLoadingMembers(true);
    try {
      const [membersRes, usersRes] = await Promise.all([
        fetch(`/api/users/groups/${groupId}/members`),
        fetch('/api/users'),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setAllUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!membersGroupId) {
      return;
    }
    try {
      const response = await fetch(`/api/users/groups/${membersGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) {
        handleManageMembers(membersGroupId);
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to add member:', error);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!membersGroupId) {
      return;
    }
    try {
      const response = await fetch(`/api/users/groups/${membersGroupId}/members/${userId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        handleManageMembers(membersGroupId);
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to remove member:', error);
    }
  };

  const filteredGroups = groups.filter(
    (group) =>
      group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <>
      <PageHeader
        title="Groups"
        description="Organize users into groups for easier permission management"
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Group
          </Button>
        }
      />

      <AdminPageContent>
        <AdminToolbar
          title="Group directory"
          description="Organize members into reusable groups and manage membership from one place."
          actions={
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {filteredGroups.length} groups
            </div>
          }
        >
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </AdminToolbar>

        {/* Groups Grid */}
        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <AdminSurface key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </AdminSurface>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <AdminEmptyState
            icon={<Users className="h-6 w-6" />}
            title="No groups yet"
            description="Create reusable groups to assign access faster and keep permissions consistent as your room portfolio grows."
            action={
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first group
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((group) => (
              <AdminSurface
                key={group.id}
                className="transition-all hover:-translate-y-0.5 hover:border-sky-200 dark:hover:border-sky-800"
              >
                <CardHeader className="px-0 pb-2 pt-0">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
                        Group
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-slate-950 dark:text-white">
                        {group.name}
                      </h3>
                      {group.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                          {group.description}
                        </p>
                      )}
                    </div>
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
                        <DropdownMenuItem onClick={() => handleEditGroup(group)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleManageMembers(group.id)}>
                          <Users className="mr-2 h-4 w-4" />
                          Manage Members
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-danger-600"
                          onClick={() => setDeleteGroup(group)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-0 pt-3">
                  <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{group.memberCount} members</span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                    Created {formatDate(group.createdAt)}
                  </p>
                </CardContent>
              </AdminSurface>
            ))}
          </div>
        )}
      </AdminPageContent>

      {/* Create Group Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
            <DialogDescription>
              Create a new group to organize users and manage permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                placeholder="Investors"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="groupDescription">Description (optional)</Label>
              <Textarea
                id="groupDescription"
                placeholder="External investors with read-only access"
                value={newGroup.description}
                onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateGroup}
              loading={isCreating}
              disabled={!newGroup.name.trim()}
            >
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>Update group name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editGroupName">Group Name</Label>
              <Input
                id="editGroupName"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editGroupDescription">Description (optional)</Label>
              <Textarea
                id="editGroupDescription"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              loading={isSavingEdit}
              disabled={!editForm.name.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteGroup}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroup(null);
          }
        }}
        title="Delete Group"
        description={
          deleteGroup ? `Delete group "${deleteGroup.name}"? This cannot be undone.` : ''
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleteGroup) {
            await handleDeleteGroup(deleteGroup);
            setDeleteGroup(null);
          }
        }}
      />

      {/* Manage Members Dialog */}
      <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Members</DialogTitle>
            <DialogDescription>Add or remove users from this group.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingMembers ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                {/* Current Members */}
                <div className="mb-4">
                  <p className="mb-2 text-sm font-medium text-neutral-700">
                    Current Members ({members.length})
                  </p>
                  {members.length === 0 ? (
                    <p className="text-sm text-neutral-500">No members in this group yet.</p>
                  ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded border p-2"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {member.firstName} {member.lastName}
                            </p>
                            <p className="text-xs text-neutral-500">{member.email}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <Trash2 className="h-4 w-4 text-danger-600" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Members */}
                {(() => {
                  const memberIds = new Set(members.map((m) => m.id));
                  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));
                  if (nonMembers.length === 0) {
                    return null;
                  }
                  return (
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Add Members</p>
                      <div className="max-h-48 space-y-2 overflow-y-auto">
                        {nonMembers.map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center justify-between rounded border p-2"
                          >
                            <div>
                              <p className="text-sm font-medium">
                                {user.firstName} {user.lastName}
                              </p>
                              <p className="text-xs text-neutral-500">{user.email}</p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAddMember(user.id)}
                            >
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMembersDialog(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
