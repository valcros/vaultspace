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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
        params.set('type', eventType);
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
    // TODO: Implement CSV export
    void 0; // placeholder
  };

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Track all actions across your organization"
        actions={
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        }
      />

      <div className="p-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder="Search by user or target..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-[200px]">
              <Filter className="w-4 h-4 mr-2" />
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
              <div key={i} className="flex items-start gap-4 p-4 border rounded-lg">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2 mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <Card className="p-12 text-center">
            <Activity className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">No activity yet</h3>
            <p className="text-neutral-500 max-w-sm mx-auto">
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
                  className="flex items-start gap-4 p-4 border rounded-lg hover:bg-neutral-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-neutral-600" />
                  </div>
                  <div className="flex-1 min-w-0">
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
                    <div className="flex items-center gap-3 mt-1 text-xs text-neutral-400">
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
          <div className="text-center mt-6">
            <Button variant="outline">Load More</Button>
          </div>
        )}
      </div>
    </>
  );
}
