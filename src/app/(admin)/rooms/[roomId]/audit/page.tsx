'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  Activity,
  FileText,
  Eye,
  Upload,
  Trash2,
  UserPlus,
  UserMinus,
  Settings,
  Link2,
  Shield,
  Filter,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

interface AuditEvent {
  id: string;
  eventType: string;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: {
    id?: string;
    name?: string;
    email: string;
    identityLabel: string;
  } | null;
  provenance: 'native' | 'legacy' | 'inferred';
  auditStatus: 'authoritative' | 'shadow' | 'inferred';
}

interface AuditData {
  events: AuditEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  coverage: {
    auditCaptureMode: 'OFF' | 'SHADOW' | 'AUTHORITATIVE';
    historicalInferenceIncluded: boolean;
    identityNotice: string;
  };
}

const eventIcons: Record<string, React.ElementType> = {
  DOCUMENT_VIEWED: Eye,
  DOCUMENT_UPLOADED: Upload,
  DOCUMENT_DELETED: Trash2,
  DOCUMENT_DOWNLOADED: Download,
  DOCUMENT_RESTORED: FileText,
  PERMISSION_GRANTED: UserPlus,
  PERMISSION_REVOKED: UserMinus,
  ROOM_SETTINGS_UPDATED: Settings,
  LINK_CREATED: Link2,
  LINK_DELETED: Link2,
  LINK_ACCESSED: Link2,
  LINK_ACCESS_DENIED: Shield,
  ROOM_CREATED: Activity,
  ROOM_ARCHIVED: Activity,
};

const eventLabels: Record<string, string> = {
  DOCUMENT_VIEWED: 'Document Viewed',
  DOCUMENT_UPLOADED: 'Document Uploaded',
  DOCUMENT_DELETED: 'Document Deleted',
  DOCUMENT_DOWNLOADED: 'Document Downloaded',
  DOCUMENT_RESTORED: 'Document Restored',
  PERMISSION_GRANTED: 'Permission Granted',
  PERMISSION_REVOKED: 'Permission Revoked',
  ROOM_SETTINGS_UPDATED: 'Settings Updated',
  LINK_CREATED: 'Link Created',
  LINK_DELETED: 'Link Deleted',
  LINK_ACCESSED: 'Link Accessed',
  LINK_ACCESS_DENIED: 'Link Access Denied',
  ROOM_CREATED: 'Room Created',
  ROOM_ARCHIVED: 'Room Archived',
};

export default function RoomAuditPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [auditData, setAuditData] = React.useState<AuditData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [eventType, setEventType] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [roomName, setRoomName] = React.useState<string>('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const deferredSearch = React.useDeferredValue(searchQuery.trim());

  const fetchAudit = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '50');
      if (eventType !== 'all') {
        params.set('eventType', eventType);
      }
      params.set('roomId', roomId);
      if (deferredSearch) {
        params.set('search', deferredSearch);
      }

      const [auditResponse, roomResponse] = await Promise.all([
        fetch(`/api/organization/activity?${params}`),
        page === 1 ? fetch(`/api/rooms/${roomId}`) : Promise.resolve(null),
      ]);

      if (auditResponse.ok) {
        const data = await auditResponse.json();
        setAuditData(data);
      }

      if (roomResponse?.ok) {
        const roomData = await roomResponse.json();
        setRoomName(roomData.room?.name || 'Room');
      }
    } catch (error) {
      console.error('Failed to fetch audit:', error);
    } finally {
      setIsLoading(false);
    }
  }, [roomId, page, eventType, deferredSearch]);

  React.useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      params.set('export', 'csv');
      params.set('roomId', roomId);
      if (eventType !== 'all') {
        params.set('eventType', eventType);
      }
      if (deferredSearch) {
        params.set('search', deferredSearch);
      }

      const response = await fetch(`/api/organization/activity?${params}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${roomId}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }
    } catch (error) {
      console.error('Failed to export audit:', error);
    }
  };

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
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getEventVariant = (eventType: string): 'default' | 'secondary' | 'danger' | 'outline' => {
    if (eventType.includes('DELETED') || eventType.includes('REVOKED')) {
      return 'danger';
    }
    if (eventType.includes('VIEWED') || eventType.includes('ACCESSED')) {
      return 'secondary';
    }
    return 'default';
  };

  if (isLoading && page === 1) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
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
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit Trail"
        description="Complete history of all room activity"
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: roomName, href: `/rooms/${roomId}` },
          { label: 'Audit' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => router.push(`/rooms/${roomId}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Room
            </Button>
          </div>
        }
      />

      <div className="p-6">
        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="relative min-w-[280px] flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden="true"
            />
            <Input
              aria-label="Search room activity"
              placeholder="Search actor, asserted email, folder, or document"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-neutral-500" />
            <span className="text-sm text-neutral-500">Filter:</span>
          </div>
          <Select
            value={eventType}
            onValueChange={(value) => {
              setEventType(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[200px]" aria-label="Filter by event type">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="DOCUMENT_VIEWED">Document Views</SelectItem>
              <SelectItem value="DOCUMENT_UPLOADED">Document Uploads</SelectItem>
              <SelectItem value="DOCUMENT_DOWNLOADED">Document Downloads</SelectItem>
              <SelectItem value="DOCUMENT_DELETED">Document Deletions</SelectItem>
              <SelectItem value="PERMISSION_GRANTED">Permissions Granted</SelectItem>
              <SelectItem value="PERMISSION_REVOKED">Permissions Revoked</SelectItem>
              <SelectItem value="LINK_ACCESSED">Link Access</SelectItem>
              <SelectItem value="LINK_ACCESS_DENIED">Denied Link Access</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {auditData?.coverage && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <span className="font-medium">
              Audit capture: {auditData.coverage.auditCaptureMode}
            </span>
            <span className="mx-2 text-slate-400">•</span>
            Inferred rows come from viewer sessions without linked native access events. External
            emails are asserted and not verified.
          </div>
        )}

        {/* Audit Events */}
        {!auditData || auditData.events.length === 0 ? (
          <Card className="p-12 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">No audit events</h3>
            <p className="mx-auto max-w-sm text-neutral-500">
              Activity in this room will be recorded here for compliance and security purposes.
            </p>
          </Card>
        ) : (
          <>
            <div className="space-y-2">
              {auditData.events.map((event) => {
                const Icon = eventIcons[event.eventType] || Activity;
                const label = eventLabels[event.eventType] || event.eventType.replace(/_/g, ' ');

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-neutral-50"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
                      <Icon className="h-5 w-5 text-neutral-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getEventVariant(event.eventType)}>{label}</Badge>
                        {event.actor ? (
                          <>
                            <span className="text-sm font-medium">
                              {event.actor.name || event.actor.email}
                            </span>
                            {event.actor.identityLabel === 'Asserted email' && (
                              <Badge variant="outline" className="text-[10px]">
                                Asserted email
                              </Badge>
                            )}
                          </>
                        ) : (
                          <span className="text-sm text-neutral-500">System</span>
                        )}
                      </div>
                      {event.description && (
                        <p className="mt-1 text-sm text-neutral-600">{event.description}</p>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs text-neutral-600">
                        <span>{formatDate(event.createdAt)}</span>
                        {event.ipAddress && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              IP {event.ipAddress}
                            </span>
                          </>
                        )}
                        {event.actor?.email && (
                          <>
                            <span>•</span>
                            <span>{event.actor.email}</span>
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

            {/* Pagination */}
            {auditData.pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm text-neutral-500">
                  Showing {(page - 1) * auditData.pagination.limit + 1} to{' '}
                  {Math.min(page * auditData.pagination.limit, auditData.pagination.total)} of{' '}
                  {auditData.pagination.total} events
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
                    Page {page} of {auditData.pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(auditData.pagination.totalPages, p + 1))}
                    disabled={page === auditData.pagination.totalPages || isLoading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
