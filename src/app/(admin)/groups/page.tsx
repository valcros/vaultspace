'use client';

import * as React from 'react';
import { Plus, Search, MoreHorizontal, Users, Trash2, Edit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
            <Plus className="w-4 h-4 mr-2" />
            Create Group
          </Button>
        }
      />

      <div className="p-6">
        {/* Search */}
        <div className="relative max-w-md mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Groups Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <Card className="p-12 text-center">
            <Users className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">No groups yet</h3>
            <p className="text-neutral-500 mb-6 max-w-sm mx-auto">
              Create groups to organize users and manage permissions more efficiently.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create your first group
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="hover:border-primary-200 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      {group.description && (
                        <CardDescription className="line-clamp-2 mt-1">
                          {group.description}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Users className="w-4 h-4 mr-2" />
                          Manage Members
                        </DropdownMenuItem>
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
                  <div className="flex items-center gap-4 text-sm text-neutral-500">
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{group.memberCount} members</span>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-400 mt-3">
                    Created {formatDate(group.createdAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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
    </>
  );
}
