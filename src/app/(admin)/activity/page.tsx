'use client';

import * as React from 'react';
import { Search, Filter, Download, Activity, Users } from 'lucide-react';

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
import { useRequireAdmin } from '@/components/layout/role-provider';
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
    identityLabel: string;
  } | null;
  room: {
    id: string;
    name: string;
  } | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
  folderName: string | null;
  provenance: 'native' | 'legacy' | 'inferred';
  auditStatus: 'authoritative' | 'shadow' | 'inferred';
  sourceMetadata: { source: string; sourceId: string };
}

interface ActivityResponse {
  events: ActivityEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  coverage: {
    auditCaptureMode: 'OFF' | 'SHADOW' | 'AUTHORITATIVE';
    historicalInferenceIncluded: boolean;
    identityNotice: string;
  };
}

interface UserOption {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

const eventLabels: Record<string, string> = {
  document_uploaded: 'uploaded a document',
  document_viewed: 'viewed a document',
  document_downloaded: 'downloaded a document',
  document_deleted: 'deleted a document',
  document_moved: 'moved a document',
  document_updated: 'updated a document',
  document_archived: 'archived a document',
  room_created: 'created a room',
  room_updated: 'updated room settings',
  room_status_changed: 'changed room status',
  member_added: 'added a member',
  member_removed: 'removed a member',
  permission_granted: 'granted permission',
  permission_revoked: 'revoked permission',
  link_created: 'created a share link',
  link_accessed: 'accessed via share link',
  link_access_denied: 'was denied share-link access',
  link_revoked: 'revoked a share link',
  user_created: 'created a user',
  user_invited: 'invited a user',
  user_accepted_invitation: 'accepted invitation',
  user_login: 'signed in',
  user_logout: 'signed out',
  user_updated: 'updated profile',
};

export default function ActivityPage() {
  useRequireAdmin();
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const [pagination, setPagination] = React.useState<ActivityResponse['pagination'] | null>(null);
  const [coverage, setCoverage] = React.useState<ActivityResponse['coverage'] | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [eventType, setEventType] = React.useState('all');
  const [actorId, setActorId] = React.useState('all');
  const [users, setUsers] = React.useState<UserOption[]>([]);
  const [page, setPage] = React.useState(1);
  const deferredSearch = React.useDeferredValue(searchQuery.trim());

  // Load org members for the user filter dropdown
  React.useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .catch(() => {});
  }, []);

  const fetchActivity = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '50');
      if (eventType !== 'all') {
        params.set('eventType', eventType);
      }
      if (actorId !== 'all') {
        params.set('userId', actorId);
      }
      if (deferredSearch) {
        params.set('search', deferredSearch);
      }
      const response = await fetch(`/api/organization/activity?${params}`);
      const data = (await response.json()) as ActivityResponse;
      if (response.ok) {
        setEvents(data.events || []);
        setPagination(data.pagination || null);
        setCoverage(data.coverage || null);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    } finally {
      setIsLoading(false);
    }
  }, [eventType, actorId, deferredSearch, page]);

  React.useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

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

  const handleExport = async () => {
    const params = new URLSearchParams({ export: 'csv' });
    if (eventType !== 'all') {
      params.set('eventType', eventType);
    }
    if (actorId !== 'all') {
      params.set('userId', actorId);
    }
    if (deferredSearch) {
      params.set('search', deferredSearch);
    }

    try {
      const response = await fetch(`/api/organization/activity?${params}`);
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `activity-log-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export activity:', error);
    }
  };

  const hasActiveFilters = eventType !== 'all' || actorId !== 'all' || searchQuery.length > 0;

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
          description="Search who did what, narrow by event type or user, and export the audit trail when you need to share it."
          actions={
            <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {pagination?.total ?? events.length} events
            </div>
          }
        >
          <div className="space-y-3">
            {/* Search -- full width, prominent */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by name, email, document, or room..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Filter row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={eventType}
                onValueChange={(value) => {
                  setEventType(value);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="Filter by event type"
                  className="h-9 w-[170px] rounded-lg border-slate-200 bg-white text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <SelectValue placeholder="Event type" />
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

              {users.length > 0 && (
                <Select
                  value={actorId}
                  onValueChange={(value) => {
                    setActorId(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    aria-label="Filter by user"
                    className="h-9 w-[190px] rounded-lg border-slate-200 bg-white text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <Users className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {(() => {
                      const nameCounts: Record<string, number> = {};
                      for (const u of users) {
                        if (u.firstName && u.lastName) {
                          const n = `${u.firstName} ${u.lastName}`;
                          nameCounts[n] = (nameCounts[n] ?? 0) + 1;
                        }
                      }
                      return users.map((u) => {
                        const fullName =
                          u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : null;
                        const label =
                          fullName && (nameCounts[fullName] ?? 0) > 1
                            ? `${fullName} (${u.email})`
                            : (fullName ?? u.email);
                        return (
                          <SelectItem key={u.id} value={u.id}>
                            {label}
                          </SelectItem>
                        );
                      });
                    })()}
                  </SelectContent>
                </Select>
              )}

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 rounded-lg px-3 text-xs text-slate-500"
                  onClick={() => {
                    setEventType('all');
                    setActorId('all');
                    setSearchQuery('');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </AdminToolbar>

        {coverage && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <span className="font-medium">Audit capture: {coverage.auditCaptureMode}</span>
            <span className="mx-2 text-slate-400">•</span>
            Historical share sessions without a native access event are shown as inferred. External
            viewer identities use asserted email and are not verified.
          </div>
        )}

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
            {groupEventsByDate(events).map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {group.label}
                </p>
                <div className="space-y-2">
                  {group.events.map((event) => {
                    const style = getEventStyle(event.eventType);
                    const EventIcon = style.icon;
                    const label =
                      eventLabels[event.eventType.toLowerCase()] ??
                      event.eventType.toLowerCase().replace(/_/g, ' ');

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
                                {event.actor.identityLabel === 'Asserted email' && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    Asserted email
                                  </Badge>
                                )}
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
                            {event.folderName && (
                              <>
                                <span className="text-neutral-400"> in </span>
                                <span className="font-medium text-slate-600 dark:text-slate-300">
                                  {event.folderName}
                                </span>
                              </>
                            )}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
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
                                <span>IP {event.ipAddress}</span>
                              </>
                            )}
                            {event.auditStatus !== 'authoritative' && (
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {event.auditStatus}
                              </Badge>
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

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Showing {(page - 1) * pagination.limit + 1} to{' '}
              {Math.min(page * pagination.limit, pagination.total)} of {pagination.total} events
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1 || isLoading}
              >
                Previous
              </Button>
              <span className="px-2 text-sm text-neutral-500">
                Page {page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                disabled={page === pagination.totalPages || isLoading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </AdminPageContent>
    </>
  );
}
