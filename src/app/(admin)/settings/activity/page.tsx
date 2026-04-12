'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  Activity,
  LogIn,
  LogOut,
  Settings,
  Users,
  Shield,
  AlertTriangle,
  FileText,
  Link2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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

interface ActivityEvent {
  id: string;
  eventType: string;
  actorType: string;
  actor:
    | {
        id: string;
        name: string;
        email: string;
      }
    | {
        email: string;
      }
    | null;
  room: {
    id: string;
    name: string;
  } | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface ActivityResponse {
  events: ActivityEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const eventIcons: Record<string, React.ElementType> = {
  USER_LOGIN: LogIn,
  USER_LOGOUT: LogOut,
  USER_INVITED: Users,
  USER_CREATED: Users,
  USER_DELETED: Users,
  SETTINGS_UPDATED: Settings,
  BRANDING_UPDATED: Settings,
  SECURITY_ALERT: AlertTriangle,
  ROLE_CHANGED: Shield,
  PERMISSION_GRANTED: Shield,
  PERMISSION_REVOKED: Shield,
  DOCUMENT_UPLOADED: FileText,
  DOCUMENT_VIEWED: FileText,
  DOCUMENT_DOWNLOADED: FileText,
  DOCUMENT_DELETED: FileText,
  LINK_CREATED: Link2,
  LINK_ACCESSED: Link2,
};

const eventLabels: Record<string, string> = {
  USER_LOGIN: 'signed in',
  USER_LOGOUT: 'signed out',
  USER_INVITED: 'invited a user',
  USER_CREATED: 'created a user',
  USER_DELETED: 'deleted a user',
  SETTINGS_UPDATED: 'updated settings',
  BRANDING_UPDATED: 'updated branding',
  SECURITY_ALERT: 'security alert',
  ROLE_CHANGED: 'changed role',
  PERMISSION_GRANTED: 'granted permission',
  PERMISSION_REVOKED: 'revoked permission',
  DOCUMENT_UPLOADED: 'uploaded document',
  DOCUMENT_VIEWED: 'viewed document',
  DOCUMENT_DOWNLOADED: 'downloaded document',
  DOCUMENT_DELETED: 'deleted document',
  LINK_CREATED: 'created link',
  LINK_ACCESSED: 'accessed link',
};

export default function SettingsActivityPage() {
  const router = useRouter();
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const [pagination, setPagination] = React.useState<ActivityResponse['pagination'] | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [eventTypeFilter, setEventTypeFilter] = React.useState('all');
  const [page, setPage] = React.useState(1);

  const fetchActivity = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '50');
      if (eventTypeFilter !== 'all') {
        params.set('eventType', eventTypeFilter);
      }
      const response = await fetch(`/api/organization/activity?${params}`);
      const data = await response.json();
      if (response.ok) {
        setEvents(data.events || []);
        setPagination(data.pagination || null);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    } finally {
      setIsLoading(false);
    }
  }, [eventTypeFilter, page]);

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
    try {
      const params = new URLSearchParams();
      params.set('export', 'csv');
      if (eventTypeFilter !== 'all') {
        params.set('eventType', eventTypeFilter);
      }

      const response = await fetch(`/api/organization/activity?${params}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-log-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }
    } catch (error) {
      console.error('Failed to export activity:', error);
    }
  };

  const getActorName = (actor: ActivityEvent['actor']): string => {
    if (!actor) {
      return 'System';
    }
    if ('name' in actor) {
      return actor.name;
    }
    return actor.email;
  };

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Track organization-wide activity and security events"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Activity' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => router.push('/settings')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Settings
            </Button>
          </div>
        }
      />

      <AdminPageContent>
        <AdminToolbar
          title="Organization event stream"
          description="Review organization-wide operational and security activity, then export the filtered stream when needed."
          actions={
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {pagination?.total ?? events.length} events
            </div>
          }
        >
          <div className="flex items-center gap-4">
            <Select
              value={eventTypeFilter}
              onValueChange={(value) => {
                setEventTypeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="USER_LOGIN">User Login</SelectItem>
                <SelectItem value="USER_LOGOUT">User Logout</SelectItem>
                <SelectItem value="USER_INVITED">User Invited</SelectItem>
                <SelectItem value="SETTINGS_UPDATED">Settings Updated</SelectItem>
                <SelectItem value="PERMISSION_GRANTED">Permission Granted</SelectItem>
                <SelectItem value="PERMISSION_REVOKED">Permission Revoked</SelectItem>
                <SelectItem value="DOCUMENT_UPLOADED">Document Uploaded</SelectItem>
                <SelectItem value="DOCUMENT_VIEWED">Document Viewed</SelectItem>
                <SelectItem value="DOCUMENT_DOWNLOADED">Document Downloaded</SelectItem>
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
            description="Activity will appear here as users, documents, permissions, and settings change across your organization."
          />
        ) : (
          <AdminSurface className="space-y-2">
            {events.map((event) => {
              const Icon = eventIcons[event.eventType] || Activity;
              const label =
                eventLabels[event.eventType] || event.eventType.replace(/_/g, ' ').toLowerCase();
              const isSecurityEvent =
                event.eventType.includes('SECURITY') || event.eventType.includes('ALERT');

              return (
                <div
                  key={event.id}
                  className={`flex items-start gap-4 rounded-xl border p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/45 ${
                    isSecurityEvent ? 'border-warning-200 bg-warning-50' : ''
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                      isSecurityEvent ? 'bg-warning-100' : 'bg-neutral-100'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${isSecurityEvent ? 'text-warning-600' : 'text-neutral-600'}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{getActorName(event.actor)}</span>
                      <span className="text-neutral-500"> {label}</span>
                      {event.room && (
                        <>
                          <span className="text-neutral-500"> in </span>
                          <span className="font-medium">{event.room.name}</span>
                        </>
                      )}
                    </p>
                    {event.description && (
                      <p className="mt-1 text-sm text-neutral-600">{event.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                      <span>{formatDate(event.createdAt)}</span>
                      {event.ipAddress && (
                        <>
                          <span>•</span>
                          <span>{event.ipAddress}</span>
                        </>
                      )}
                      {isSecurityEvent && (
                        <>
                          <span>•</span>
                          <Badge variant="warning" className="text-xs">
                            Security
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </AdminSurface>
        )}

        {/* Pagination */}
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
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
