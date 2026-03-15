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

interface Room {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  documentCount: number;
  memberCount: number;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function RoomsPage() {
  const router = useRouter();
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

  return (
    <>
      <PageHeader
        title="Data Rooms"
        description="Manage your secure data rooms"
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Room
          </Button>
        }
      />

      <div className="p-6">
        {/* Search */}
        <div className="relative max-w-md mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <Input
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Room Grid */}
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
                  <Skeleton className="h-4 w-2/3 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <Card className="p-12 text-center">
            <FolderOpen className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">No data rooms yet</h3>
            <p className="text-neutral-500 mb-6 max-w-sm mx-auto">
              Create your first data room to start securely sharing documents with stakeholders.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create your first room
            </Button>
          </Card>
        ) : (
          <>
            {/* Active Rooms */}
            {activeRooms.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-medium text-neutral-500 mb-4">
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
                <h2 className="text-sm font-medium text-neutral-500 mb-4">
                  Archived Rooms ({archivedRooms.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {archivedRooms.map((room) => (
                    <RoomCard key={room.id} room={room} onRefresh={fetchRooms} />
                  ))}
                </div>
              </div>
            )}
          </>
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
  const handleArchive = async () => {
    try {
      await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: room.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }),
        credentials: 'include',
      });
      onRefresh();
    } catch (error) {
      console.error('Failed to archive room:', error);
    }
  };

  return (
    <Link href={`/rooms/${room.id}`}>
      <Card className="hover:border-primary-200 hover:shadow-md transition-all cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{room.name}</CardTitle>
              {room.description && (
                <CardDescription className="line-clamp-2 mt-1">
                  {room.description}
                </CardDescription>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    handleArchive();
                  }}
                >
                  <Archive className="w-4 h-4 mr-2" />
                  {room.status === 'ACTIVE' ? 'Archive' : 'Unarchive'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => e.preventDefault()}
                  className="text-danger-600"
                >
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
              <FolderOpen className="w-4 h-4" />
              <span>{room.documentCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{room.memberCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <LinkIcon className="w-4 h-4" />
              <span>{room.linkCount}</span>
            </div>
          </div>
          {room.status === 'ARCHIVED' && (
            <Badge variant="secondary" className="mt-3">
              Archived
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
