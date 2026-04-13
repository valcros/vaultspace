'use client';

import * as React from 'react';
import { Search, Filter, Download, Activity } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';
import { getEventStyle, groupEventsByDate } from '@/lib/activityUtils';

interface ActivityEvent {
  id: string;
  eventType: string;
  actorType?: string;
  actor: {
    id?: string;
    name?: string;
    email: string;
  } | null;
  room: {
    id: string;
    name: string;
  } | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
}

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
      event.actor?.name?.toLowerCase().includes(query) ||
      event.actor?.email?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query) ||
      event.room?.name?.toLowerCase().includes(query)
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
    const headers = ['Date', 'User', 'Email', 'Action', 'Description', 'Room', 'IP Address'];
    const rows = filteredEvents.map((event) => [
      new Date(event.createdAt).toISOString(),
      event.actor?.name || 'System',
      event.actor?.email || '',
      event.eventType.replace(/_/g, ' '),
      event.description || '',
      event.room?.name || '',
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

      <AdminPageContent>
        <AdminToolbar
          title="Event stream"
          description="Search who did what, narrow by event family, and export the audit trail when you need to share it."
          actions={
            <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {filteredEvents.length} events
            </div>
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by user or target..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-11 w-[220px] rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
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
        </AdminToolbar>

        {/* Activity List */}
        {isLoading ? (
          <AdminSurface className="space-y-4">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-xl border border-slate-200/80 p-4 dark:border-slate-800"
              >
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              </div>
            ))}
          </AdminSurface>
        ) : events.length === 0 ? (
          <AdminEmptyState
            icon={<Activity className="h-6 w-6" />}
            title="No activity yet"
            description="Audit events will appear here as users access rooms, review documents, and change settings across the organization."
          />
        ) : (
          <AdminSurface className="space-y-4">
            {groupEventsByDate(filteredEvents).map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {group.label}
                </p>
                <div className="space-y-2">
                  {group.events.map((event) => {
                    const style = getEventStyle(event.eventType);
                    const EventIcon = style.icon;
                    const label =
                      eventLabels[event.eventType] || event.eventType.replace(/_/g, ' ');

                    return (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 rounded-xl border border-slate-200/80 p-3 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/50"
                      >
                        <div
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${style.bg}`}
                        >
                          <EventIcon className={`h-4 w-4 ${style.text}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            {event.actor ? (
                              <>
                                <span className="font-medium">
                                  {event.actor.name || event.actor.email}
                                </span>
                                <span className="text-neutral-500"> {label}</span>
                              </>
                            ) : (
                              <span className="text-neutral-500">System {label}</span>
                            )}
                            {event.description && (
                              <>
                                <span className="text-neutral-500">: </span>
                                <span className="font-medium">{event.description}</span>
                              </>
                            )}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                            <span>{formatDate(event.createdAt)}</span>
                            {event.room && (
                              <>
                                <span>•</span>
                                <Badge variant="outline" className="text-xs">
                                  {event.room.name}
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
              </div>
            ))}
          </AdminSurface>
        )}

        {/* Load More */}
        {events.length > 0 && events.length >= 50 && (
          <div className="mt-6 text-center">
            <Button variant="outline">Load More</Button>
          </div>
        )}
      </AdminPageContent>
    </>
  );
}
