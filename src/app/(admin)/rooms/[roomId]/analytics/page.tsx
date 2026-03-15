'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BarChart3, Eye, Download, Users, FileText, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

interface RoomAnalytics {
  summary: {
    totalDocuments: number;
    totalViews: number;
    uniqueViewers: number;
    totalDownloads: number;
  };
  topDocuments: Array<{
    id: string;
    name: string;
    viewCount: number;
    downloadCount: number;
    lastViewedAt: string | null;
    createdAt: string;
  }>;
  recentViewers: Array<{
    email: string | null;
    name: string | null;
    timeSpent: number | null;
    lastActive: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    description: string | null;
    actor: string;
    createdAt: string;
  }>;
  viewTimeline: Array<{
    date: string;
    count: number;
  }>;
  period: {
    days: number;
    startDate: string;
  };
}

export default function RoomAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [analytics, setAnalytics] = React.useState<RoomAnalytics | null>(null);
  const [roomName, setRoomName] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchAnalytics = React.useCallback(async () => {
    try {
      const [analyticsRes, roomRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}/analytics`),
        fetch(`/api/rooms/${roomId}`),
      ]);

      if (analyticsRes.ok) {
        const data = await analyticsRes.json();
        setAnalytics(data);
      } else if (analyticsRes.status === 404) {
        router.push('/rooms');
        return;
      }

      if (roomRes.ok) {
        const roomData = await roomRes.json();
        setRoomName(roomData.room?.name || 'Room');
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [roomId, router]);

  React.useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-96 mb-8" />
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Room Analytics"
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: roomName, href: `/rooms/${roomId}` },
          { label: 'Analytics' },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.push(`/rooms/${roomId}`)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Room
          </Button>
        }
      />

      <div className="p-6">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Total Views
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.summary.totalViews.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Unique Viewers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.summary.uniqueViewers.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Total Downloads
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.summary.totalDownloads.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Total Documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics.summary.totalDocuments.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>

        {/* Top Documents */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <CardTitle>Top Documents</CardTitle>
                <CardDescription>Most viewed documents in this room</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {analytics.topDocuments.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-8">
                No document activity yet
              </p>
            ) : (
              <div className="space-y-4">
                {analytics.topDocuments.map((doc, index) => (
                  <div key={doc.id} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{doc.name}</p>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-neutral-500">
                      <div className="flex items-center gap-1">
                        <Eye className="w-4 h-4" />
                        {doc.viewCount}
                      </div>
                      <div className="flex items-center gap-1">
                        <Download className="w-4 h-4" />
                        {doc.downloadCount}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Chart Placeholder */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <CardTitle>Activity Over Time</CardTitle>
                <CardDescription>Views over the past {analytics.period.days} days</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {analytics.viewTimeline.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-16">
                No activity data available
              </p>
            ) : (
              <div className="h-64 flex items-center justify-center text-neutral-400">
                <div className="text-center">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4" />
                  <p className="text-sm">Chart visualization coming soon</p>
                  <p className="text-xs mt-2">
                    {analytics.viewTimeline.length} days of data available
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
