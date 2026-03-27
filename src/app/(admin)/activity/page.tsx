'use client';

import * as React from 'react';
import {
  Search,
  Filter,
  Download,
  Activity,
  FileText,
  Users,
  Link as LinkIcon,
  Eye,
  Upload,
  Trash2,
  Settings,
  LogIn,
  LogOut,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

interface ActivityEvent {
  id: string;
  type: string;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  roomId: string | null;
  roomName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

const eventIcons: Record<string, React.ElementType> = {
  document_uploaded: Upload,
  document_viewed: Eye,
  document_downloaded: Download,
  document_deleted: Trash2,
  room_created: FileText,
  room_updated: Settings,
  member_added: Users,
  member_removed: Users,
  link_created: LinkIcon,
  link_accessed: Eye,
  user_login: LogIn,
  user_logout: LogOut,
};

const eventLabels: Record<string, string> = {
  document_uploaded: 'uploaded a document',
  document_viewed: 'viewed a document',
  document_downloaded: 'downloaded a document',
  document_deleted: 'deleted a document',
  room_created: 'created a room',
  room_updated: 'updated room settings',
  member_added: 'added a member',
  member_removed: 'removed a member',
  link_created: 'created a share link',
  link_accessed: 'accessed via share link',
  user_login: 'signed in',
  user_logout: 'signed out',
};

export default function ActivityPage() {
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [eventType, setEventType] = React.useState('all');

  const fetchActivity = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (eventType !== 'all') {
        params.set('eventType', eventType);
      }
      const response = await fetch(`/api/organization/activity?${params}`);
      const data = await response.json();
      if (response.ok) {
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    } finally {
      setIsLoading(false);
    }
  }, [eventType]);

  React.useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const filteredEvents = events.filter((event) => {
    if (!searchQuery) {
      return true;
    }
    const query = searchQuery.toLowerCase();
    return (
      event.actor?.firstName.toLowerCase().includes(query) ||
      event.actor?.lastName.toLowerCase().includes(query) ||
      event.actor?.email.toLowerCase().includes(query) ||
      event.targetName?.toLowerCase().includes(query) ||
      event.roomName?.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const handleExport = () => {
    const headers = ['Date', 'User', 'Email', 'Action', 'Target', 'Room', 'IP Address'];
    const rows = filteredEvents.map((event) => [
      new Date(event.createdAt).toISOString(),
      event.actor ? `${event.actor.firstName} ${event.actor.lastName}` : 'System',
      event.actor?.email || '',
      event.type.replace(/_/g, ' '),
      event.targetName || '',
      event.roomName || '',
      event.ipAddress || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `activity-log-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Track all actions across your organization"
        actions={
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="p-6">
        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Search by user or target..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-[200px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="room">Rooms</SelectItem>
              <SelectItem value="member">Members</SelectItem>
              <SelectItem value="link">Share Links</SelectItem>
              <SelectItem value="auth">Authentication</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Activity List */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="flex items-start gap-4 rounded-lg border p-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <Card className="p-12 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">No activity yet</h3>
            <p className="mx-auto max-w-sm text-neutral-500">
              Activity will appear here as users interact with your data rooms.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredEvents.map((event) => {
              const Icon = eventIcons[event.type] || Activity;
              const label = eventLabels[event.type] || event.type.replace(/_/g, ' ');

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-neutral-50"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
                    <Icon className="h-5 w-5 text-neutral-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {event.actor ? (
                        <>
                          <span className="font-medium">
                            {event.actor.firstName} {event.actor.lastName}
                          </span>
                          <span className="text-neutral-500"> {label}</span>
                        </>
                      ) : (
                        <span className="text-neutral-500">System {label}</span>
                      )}
                      {event.targetName && (
                        <>
                          <span className="text-neutral-500">: </span>
                          <span className="font-medium">{event.targetName}</span>
                        </>
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                      <span>{formatDate(event.createdAt)}</span>
                      {event.roomName && (
                        <>
                          <span>•</span>
                          <Badge variant="outline" className="text-xs">
                            {event.roomName}
                          </Badge>
                        </>
                      )}
                      {event.ipAddress && (
                        <>
                          <span>•</span>
                          <span>{event.ipAddress}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load More */}
        {events.length > 0 && events.length >= 50 && (
          <div className="mt-6 text-center">
            <Button variant="outline">Load More</Button>
          </div>
        )}
      </div>
    </>
  );
}
