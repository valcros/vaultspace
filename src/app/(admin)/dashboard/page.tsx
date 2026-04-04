'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import {
  ActionRequiredWidget,
  MessagesWidget,
  MyRoomsWidget,
  RecentActivityWidget,
  ContinueReadingWidget,
  BookmarksWidget,
  NewDocumentsWidget,
  MyQuestionsWidget,
  ChecklistProgressWidget,
  EngagementWidget,
  AnnouncementsWidget,
  FeaturedAnnouncement,
  WelcomeBanner,
} from '@/components/dashboard';

// ---------------------------------------------------------------------------
// Types (matches API v2 response)
// ---------------------------------------------------------------------------

interface DashboardV2Data {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
    lastLoginAt: string | null;
  };
  actionRequired?: {
    totalCount: number;
    unansweredQuestions: number;
    pendingAccessRequests: number;
    items: Array<{
      id: string;
      type: 'question' | 'access_request' | 'review';
      title: string;
      description: string;
      roomId: string;
      roomName: string;
      createdAt: string;
      priority: 'high' | 'normal';
    }>;
  };
  messages?: {
    unreadCount: number;
    recent: Array<{
      id: string;
      senderName: string;
      subject: string;
      preview: string;
      createdAt: string;
      isRead: boolean;
      roomName?: string;
    }>;
  };
  myRooms?: Array<{
    id: string;
    name: string;
    status: string;
    documentCount: number;
    viewerCount: number;
    questionCount: number;
    lastActivity?: string;
  }>;
  recentActivity?: Array<{
    id: string;
    eventType: string;
    actorName: string;
    actorEmail?: string;
    description: string;
    roomId?: string;
    roomName?: string;
    documentId?: string;
    documentName?: string;
    createdAt: string;
  }>;
  engagementInsights?: {
    period: '7d' | '30d';
    totalViews: number;
    uniqueViewers: number;
    downloads: number;
    dailyActivity: Array<{ date: string; views: number }>;
    topDocuments: Array<{ id: string; name: string; roomName: string; views: number }>;
  };
  checklistProgress?: Array<{
    id: string;
    name: string;
    roomId: string;
    roomName: string;
    completedCount: number;
    totalCount: number;
    missingItems: string[];
  }>;
  continueReading?: Array<{
    documentId: string;
    documentName: string;
    roomId: string;
    roomName: string;
    lastPage?: number;
    totalPages?: number;
    lastViewedAt: string;
  }>;
  bookmarks?: Array<{
    id: string;
    documentId: string;
    documentName: string;
    roomId: string;
    roomName: string;
    folderPath?: string;
    createdAt: string;
  }>;
  newSinceLastVisit?: {
    newDocuments: Array<{
      id: string;
      name: string;
      roomId: string;
      roomName: string;
      folderPath?: string;
      createdAt: string;
      isNew: boolean;
    }>;
    updatedDocuments: Array<{
      id: string;
      name: string;
      roomId: string;
      roomName: string;
      folderPath?: string;
      createdAt: string;
      updatedAt?: string;
      isNew: boolean;
    }>;
  };
  myQuestions?: Array<{
    id: string;
    question: string;
    status: 'OPEN' | 'ANSWERED' | 'CLOSED';
    roomName: string;
    documentName?: string;
    createdAt: string;
    answeredAt?: string;
  }>;
  announcements?: Array<{
    id: string;
    content: string;
    authorName: string;
    roomName: string;
    createdAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = React.useState<DashboardV2Data | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard/v2', { credentials: 'include' });
        if (res.ok) {
          setData(await res.json());
        } else {
          setError('Failed to load dashboard');
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err);
        setError('Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="flex h-64 items-center justify-center text-neutral-500">
          {error}.{' '}
          <button
            onClick={() => window.location.reload()}
            className="ml-2 text-primary-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  const isAdmin = data?.user?.role === 'ADMIN';
  const isViewer = data?.user?.role === 'VIEWER';

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={
          isLoading ? 'Dashboard' : `${greeting}, ${data?.user?.name?.split(' ')[0] || 'there'}`
        }
        description={
          isLoading
            ? undefined
            : data?.user?.lastLoginAt
              ? `Last login: ${formatDistanceToNow(new Date(data.user.lastLoginAt), { addSuffix: true })}`
              : undefined
        }
        actions={
          isAdmin ? (
            <Link href="/rooms/new">
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New Room
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {/* Welcome banner for new users */}
        {!isLoading && data?.myRooms && <WelcomeBanner roomCount={data.myRooms.length} />}

        {/* Featured announcement */}
        {!isLoading && data?.announcements && data.announcements.length > 0 && (
          <FeaturedAnnouncement announcement={data.announcements[0] ?? null} />
        )}

        {/* Admin Dashboard Layout */}
        {isAdmin && <AdminDashboard data={data} isLoading={isLoading} />}

        {/* Viewer Dashboard Layout */}
        {isViewer && <ViewerDashboard data={data} isLoading={isLoading} />}

        {/* Loading state (before we know the role) */}
        {isLoading && <LoadingDashboard />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin Dashboard Layout
// ---------------------------------------------------------------------------

function AdminDashboard({ data, isLoading }: { data: DashboardV2Data | null; isLoading: boolean }) {
  return (
    <>
      {/* Action Required + Messages row */}
      <div className="grid gap-6 md:grid-cols-2">
        {data?.actionRequired && (
          <ActionRequiredWidget
            totalCount={data.actionRequired.totalCount}
            unansweredQuestions={data.actionRequired.unansweredQuestions}
            pendingAccessRequests={data.actionRequired.pendingAccessRequests}
            items={data.actionRequired.items}
            loading={isLoading}
          />
        )}
        {data?.messages && (
          <MessagesWidget
            unreadCount={data.messages.unreadCount}
            messages={data.messages.recent}
            loading={isLoading}
          />
        )}
      </div>

      {/* Engagement + Rooms row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {data?.engagementInsights && (
          <div className="lg:col-span-2">
            <EngagementWidget data={data.engagementInsights} loading={isLoading} />
          </div>
        )}
        {data?.myRooms && <MyRoomsWidget rooms={data.myRooms} loading={isLoading} />}
      </div>

      {/* Activity + Checklists row */}
      <div className="grid gap-6 md:grid-cols-2">
        {data?.recentActivity && (
          <RecentActivityWidget activities={data.recentActivity} loading={isLoading} />
        )}
        {data?.checklistProgress && data.checklistProgress.length > 0 && (
          <ChecklistProgressWidget checklists={data.checklistProgress} loading={isLoading} />
        )}
      </div>

      {/* Personal widgets row */}
      <div className="grid gap-6 md:grid-cols-3">
        {data?.continueReading && data.continueReading.length > 0 && (
          <ContinueReadingWidget items={data.continueReading} loading={isLoading} />
        )}
        {data?.bookmarks && <BookmarksWidget bookmarks={data.bookmarks} loading={isLoading} />}
        {data?.newSinceLastVisit && (
          <NewDocumentsWidget
            newDocuments={data.newSinceLastVisit.newDocuments}
            updatedDocuments={data.newSinceLastVisit.updatedDocuments}
            loading={isLoading}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Viewer Dashboard Layout
// ---------------------------------------------------------------------------

function ViewerDashboard({
  data,
  isLoading,
}: {
  data: DashboardV2Data | null;
  isLoading: boolean;
}) {
  return (
    <>
      {/* Messages + New Docs row - most important for viewers */}
      <div className="grid gap-6 md:grid-cols-2">
        {data?.messages && (
          <MessagesWidget
            unreadCount={data.messages.unreadCount}
            messages={data.messages.recent}
            loading={isLoading}
          />
        )}
        {data?.newSinceLastVisit && (
          <NewDocumentsWidget
            newDocuments={data.newSinceLastVisit.newDocuments}
            updatedDocuments={data.newSinceLastVisit.updatedDocuments}
            loading={isLoading}
          />
        )}
      </div>

      {/* Continue Reading + Bookmarks row */}
      <div className="grid gap-6 md:grid-cols-2">
        {data?.continueReading && data.continueReading.length > 0 && (
          <ContinueReadingWidget items={data.continueReading} loading={isLoading} />
        )}
        {data?.bookmarks && <BookmarksWidget bookmarks={data.bookmarks} loading={isLoading} />}
      </div>

      {/* My Questions + Rooms row */}
      <div className="grid gap-6 md:grid-cols-2">
        {data?.myQuestions && (
          <MyQuestionsWidget questions={data.myQuestions} loading={isLoading} />
        )}
        {data?.myRooms && <MyRoomsWidget rooms={data.myRooms} loading={isLoading} />}
      </div>

      {/* Announcements */}
      {data?.announcements && data.announcements.length > 1 && (
        <AnnouncementsWidget announcements={data.announcements.slice(1)} loading={isLoading} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function LoadingDashboard() {
  return (
    <>
      {/* Skeleton stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Skeleton widgets */}
      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-2 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
