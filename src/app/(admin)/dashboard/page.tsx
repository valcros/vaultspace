'use client';

import * as React from 'react';
import { FolderOpen, FileText, Users, HardDrive, Activity, Eye } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { getEventStyle } from '@/lib/activityUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardData {
  stats: {
    totalRooms: number;
    totalDocuments: number;
    totalMembers: number;
    totalStorage: number;
  };
  roomBreakdown: {
    DRAFT: number;
    ACTIVE: number;
    ARCHIVED: number;
    CLOSED: number;
  };
  recentActivity: Array<{
    id: string;
    eventType: string;
    actorName: string;
    description: string | null;
    roomName: string | null;
    createdAt: string;
  }>;
  topDocuments: Array<{
    documentId: string;
    name: string;
    roomName: string;
    viewCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) {
    return 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) {
    return `${diffDay}d ago`;
  }
  return new Date(dateStr).toLocaleDateString();
}

function eventLabel(eventType: string): string {
  return eventType
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 border-green-200',
  DRAFT: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  ARCHIVED: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  CLOSED: 'bg-red-100 text-red-700 border-red-200',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard', { credentials: 'include' });
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // ---------- Stat cards config ----------
  const statCards = data
    ? [
        {
          label: 'Rooms',
          value: data.stats.totalRooms,
          icon: FolderOpen,
          color: 'text-primary-600 bg-primary-50',
        },
        {
          label: 'Documents',
          value: data.stats.totalDocuments,
          icon: FileText,
          color: 'text-green-600 bg-green-50',
        },
        {
          label: 'Members',
          value: data.stats.totalMembers,
          icon: Users,
          color: 'text-purple-600 bg-purple-50',
        },
        {
          label: 'Storage',
          value: formatBytes(data.stats.totalStorage),
          icon: HardDrive,
          color: 'text-amber-600 bg-amber-50',
        },
      ]
    : [];

  return (
    <>
      <PageHeader title="Dashboard" description="Organization overview and key metrics" />

      <div className="space-y-6">
        {/* -------- Stat Cards -------- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {isLoading
            ? [...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3"
                >
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-12" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))
            : statCards.map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3"
                >
                  <div className={`rounded-lg p-2 ${stat.color}`}>
                    <stat.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-neutral-900">{stat.value}</p>
                    <p className="text-xs text-neutral-500">{stat.label}</p>
                  </div>
                </div>
              ))}
        </div>

        {/* -------- Room Status Breakdown -------- */}
        {isLoading ? (
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-24 rounded-full" />
            ))}
          </div>
        ) : data ? (
          <div className="flex flex-wrap gap-2">
            {(Object.entries(data.roomBreakdown) as [string, number][]).map(([status, count]) => (
              <Badge
                key={status}
                variant="outline"
                className={`${statusColors[status] || ''} px-3 py-1 text-sm`}
              >
                {status}: {count}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* -------- Two-Column: Activity + Top Documents -------- */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !data || data.recentActivity.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">No recent activity</p>
              ) : (
                <div className="space-y-3">
                  {data.recentActivity.map((event) => {
                    const style = getEventStyle(event.eventType);
                    const Icon = style.icon;
                    return (
                      <div key={event.id} className="flex items-start gap-3">
                        <div className={`rounded-full p-1.5 ${style.bg}`}>
                          <Icon className={`h-3.5 w-3.5 ${style.text}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-neutral-900">
                            <span className="font-medium">{event.actorName}</span>{' '}
                            <span className="text-neutral-500">
                              {event.description || eventLabel(event.eventType)}
                            </span>
                          </p>
                          <div className="flex items-center gap-2 text-xs text-neutral-400">
                            {event.roomName && <span>{event.roomName}</span>}
                            <span>{relativeTime(event.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Viewed Documents */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4" />
                Top Viewed Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-6 w-6 rounded" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !data || data.topDocuments.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">No document views yet</p>
              ) : (
                <div className="space-y-3">
                  {data.topDocuments.map((doc, index) => (
                    <div key={doc.documentId} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-xs font-semibold text-neutral-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-900">{doc.name}</p>
                        <p className="text-xs text-neutral-400">{doc.roomName}</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-neutral-500">
                        <Eye className="h-3.5 w-3.5" />
                        {doc.viewCount}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
