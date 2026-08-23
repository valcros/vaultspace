'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  FolderOpen,
  Users,
  Link as LinkIcon,
  MoreHorizontal,
  Archive,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { useIsAdmin } from '@/components/layout/role-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyRooms } from '@/components/illustrations/EmptyState';

interface Room {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'CLOSED';
  documentCount: number;
  memberCount: number;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function RoomsPage() {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [rooms, setRooms] = React.useState<Room[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [newRoom, setNewRoom] = React.useState({ name: '', description: '' });

  React.useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const response = await fetch('/api/rooms', {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setRooms(data.rooms || []);
      } else {
        console.error('Failed to fetch rooms:', data.error);
      }
    } catch (error) {
      console.error('Failed to fetch rooms:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateRoom = async () => {
    if (!newRoom.name.trim()) {
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoom),
        credentials: 'include',
      });

      const data = await response.json();
      if (response.ok) {
        setShowCreateDialog(false);
        setNewRoom({ name: '', description: '' });
        router.push(`/rooms/${data.room.id}`);
      }
    } catch (error) {
      console.error('Failed to create room:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredRooms = rooms.filter(
    (room) =>
      room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeRooms = filteredRooms.filter((r) => r.status === 'ACTIVE');
  const archivedRooms = filteredRooms.filter((r) => r.status === 'ARCHIVED');
  const draftRooms = filteredRooms.filter((r) => r.status === 'DRAFT');
  const closedRooms = filteredRooms.filter((r) => r.status === 'CLOSED');
  const hasVisibleRooms =
    draftRooms.length > 0 ||
    activeRooms.length > 0 ||
    archivedRooms.length > 0 ||
    closedRooms.length > 0;

  return (
    <>
      <PageHeader
        variant="work"
        title="Data Rooms"
        actions={
          isAdmin ? (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Room
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        {/*
          Search-first row. The earlier "Room Portfolio" explainer card
          plus stats strip plus welcome banner pushed the actual room grid
          below the fold; per advisor direction the cards should start
          higher. Everything that isn't "find the room" is gone.
        */}
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          />
          <Input
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search rooms"
            className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {/* Room Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <Card className="p-8 text-center">
            <EmptyRooms className="mx-auto mb-4" />
            {isAdmin ? (
              <>
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No data rooms yet</h3>
                <p className="mx-auto mb-6 max-w-sm text-neutral-500">
                  Create your first data room to start securely sharing documents with stakeholders.
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first room
                </Button>
              </>
            ) : (
              <>
                <h3 className="mb-2 text-lg font-semibold text-neutral-900">No rooms yet</h3>
                <p className="mx-auto max-w-sm text-neutral-500">
                  No data rooms have been shared with you yet. An administrator will grant you
                  access.
                </p>
              </>
            )}
          </Card>
        ) : hasVisibleRooms ? (
          <>
            {/* Draft Rooms */}
            {draftRooms.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Draft Rooms ({draftRooms.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {draftRooms.map((room) => (
                    <RoomCard key={room.id} room={room} onRefresh={fetchRooms} />
                  ))}
                </div>
              </div>
            )}

            {/* Active Rooms */}
            {activeRooms.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Active Rooms ({activeRooms.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {activeRooms.map((room) => (
                    <RoomCard key={room.id} room={room} onRefresh={fetchRooms} />
                  ))}
                </div>
              </div>
            )}

            {/* Archived Rooms */}
            {archivedRooms.length > 0 && (
              <div>
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Archived Rooms ({archivedRooms.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {archivedRooms.map((room) => (
                    <RoomCard key={room.id} room={room} onRefresh={fetchRooms} />
                  ))}
                </div>
              </div>
            )}

            {closedRooms.length > 0 && isAdmin && (
              <div>
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Closed Rooms ({closedRooms.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {closedRooms.map((room) => (
                    <RoomCard key={room.id} room={room} onRefresh={fetchRooms} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <Card className="p-8 text-center">
            <h3 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              No matching data rooms
            </h3>
            <p className="mx-auto max-w-sm text-neutral-500">
              Try a different search term or clear the current filter.
            </p>
          </Card>
        )}
      </div>

      {/* Create Room Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Data Room</DialogTitle>
            <DialogDescription>
              Create a new secure data room to share documents with stakeholders.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="roomName">Room Name</Label>
              <Input
                id="roomName"
                placeholder="Series A Funding"
                value={newRoom.name}
                onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roomDescription">Description (optional)</Label>
              <Textarea
                id="roomDescription"
                placeholder="Documents for Series A due diligence"
                value={newRoom.description}
                onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateRoom} loading={isCreating} disabled={!newRoom.name.trim()}>
              Create Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoomCard({ room, onRefresh }: { room: Room; onRefresh: () => void }) {
  const [isChangingStatus, setIsChangingStatus] = React.useState(false);
  const [showLifecycleConfirm, setShowLifecycleConfirm] = React.useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const transition =
    room.status === 'DRAFT'
      ? {
          status: 'ACTIVE' as const,
          label: 'Publish room',
          title: 'Publish room?',
          description:
            'Publishing makes this room discoverable to authorized viewers and eligible for active-room workflows.',
        }
      : room.status === 'ACTIVE'
        ? {
            status: 'ARCHIVED' as const,
            label: 'Archive room',
            title: 'Archive room?',
            description:
              'Archiving removes this room from viewer workflows while retaining it for administrator review.',
          }
        : room.status === 'ARCHIVED'
          ? {
              status: 'ACTIVE' as const,
              label: 'Restore room',
              title: 'Restore room?',
              description:
                'Restoring makes this room active again for authorized viewer and invitation workflows.',
            }
          : null;

  const handleTransition = async () => {
    if (!transition) {
      return;
    }
    setIsChangingStatus(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: transition.status }),
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to update room status');
      }
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update room status');
    } finally {
      setIsChangingStatus(false);
    }
  };

  const handleClose = async () => {
    setIsChangingStatus(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to close room');
      }
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to close room');
    } finally {
      setIsChangingStatus(false);
    }
  };

  const statusLabel =
    room.status === 'DRAFT'
      ? 'Draft room'
      : room.status === 'ACTIVE'
        ? 'Live room'
        : room.status === 'ARCHIVED'
          ? 'Archived room'
          : 'Closed room';

  return (
    <>
      <Link href={`/rooms/${room.id}`}>
        <Card
          className={`group relative cursor-pointer overflow-hidden border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 ${isChangingStatus ? 'opacity-50' : ''}`}
        >
          <div
            className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${
              room.status === 'ACTIVE'
                ? 'bg-primary-500'
                : room.status === 'DRAFT'
                  ? 'bg-amber-400'
                  : room.status === 'ARCHIVED'
                    ? 'bg-neutral-400'
                    : 'bg-neutral-700'
            }`}
          />
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {statusLabel}
                  </span>
                </div>
                <CardTitle className="truncate text-lg tracking-tight">{room.name}</CardTitle>
                {room.description && (
                  <CardDescription className="mt-2 line-clamp-2 text-sm leading-6">
                    {room.description}
                  </CardDescription>
                )}
              </div>
              {room.status !== 'CLOSED' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {transition && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.preventDefault();
                          setShowLifecycleConfirm(true);
                        }}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        {transition.label}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault();
                        setShowCloseConfirm(true);
                      }}
                      className="text-danger-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Close room
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Files
                </div>
                <span className="mt-1 block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.documentCount}
                </span>
              </div>
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <Users className="h-3.5 w-3.5" />
                  Members
                </div>
                <span className="mt-1 block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.memberCount}
                </span>
              </div>
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Links
                </div>
                <span className="mt-1 block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.linkCount}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4 text-sm font-medium text-neutral-500">
              {room.status === 'DRAFT' ? (
                <Badge variant="secondary" className="rounded-full px-2.5 py-1">
                  Draft
                </Badge>
              ) : room.status === 'ARCHIVED' ? (
                <Badge variant="secondary" className="rounded-full px-2.5 py-1">
                  Archived
                </Badge>
              ) : room.status === 'CLOSED' ? (
                <Badge variant="secondary" className="rounded-full px-2.5 py-1">
                  Closed
                </Badge>
              ) : (
                <span>Ready for review</span>
              )}
              <span className="text-primary-700 transition-transform group-hover:translate-x-1">
                Open room &rarr;
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>

      {actionError && (
        <p className="mt-2 text-sm text-danger-600" role="alert">
          {actionError}
        </p>
      )}
      {transition && (
        <ConfirmDialog
          open={showLifecycleConfirm}
          onOpenChange={setShowLifecycleConfirm}
          title={transition.title}
          description={transition.description}
          confirmLabel={transition.label}
          onConfirm={handleTransition}
          loading={isChangingStatus}
        />
      )}
      <ConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        title="Close room?"
        description={`This retains "${room.name}" for audit history, removes it from normal workflows, and cannot be undone.`}
        confirmLabel="Close room"
        variant="destructive"
        onConfirm={handleClose}
        loading={isChangingStatus}
      />
    </>
  );
}
