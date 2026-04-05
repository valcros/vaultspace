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
  DashboardProvider,
  DashboardControls,
  DashboardGrid,
  MobileStackedDashboard,
} from '@/components/dashboard';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { getDefaultLayout } from '@/lib/dashboard-defaults';
import type { WidgetId, DashboardLayoutConfig } from '@/types/dashboard';

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
  layout: {
    desktopLayout: Array<{
      i: string;
      x: number;
      y: number;
      w: number;
      h: number;
      minW?: number;
      minH?: number;
    }>;
    collapsedWidgets: string[];
    densityMode: 'compact' | 'cozy';
    welcomeBannerDismissed: boolean;
    isDefault: boolean;
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

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <LoadingDashboard />
      </>
    );
  }

  const isAdmin = data.user.role === 'ADMIN';

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // TEMPORARY FIX: Always use default layout to fix corrupted saved layouts
  // TODO: Remove this once layout corruption issue is resolved
  const initialLayout: DashboardLayoutConfig = {
    desktopLayout: getDefaultLayout(isAdmin ? 'ADMIN' : 'VIEWER'),
    collapsedWidgets: data.layout.collapsedWidgets,
    densityMode: data.layout.densityMode,
    welcomeBannerDismissed: data.layout.welcomeBannerDismissed,
  };

  return (
    <>
      <PageHeader
        title={`${greeting}, ${data.user.name?.split(' ')[0] || 'there'}`}
        description={
          data.user.lastLoginAt
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

      <DashboardContent data={data} initialLayout={initialLayout} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Content with Layout
// ---------------------------------------------------------------------------

interface DashboardContentProps {
  data: DashboardV2Data;
  initialLayout: DashboardLayoutConfig;
}

function DashboardContent({ data, initialLayout }: DashboardContentProps) {
  const role = data.user.role;
  const isMobile = useIsMobile();

  const {
    layout,
    collapsedWidgets,
    density,
    welcomeBannerDismissed,
    isSaving,
    updateLayout,
    toggleCollapsed,
    setDensity,
    dismissWelcomeBanner,
    resetLayout,
  } = useDashboardLayout({
    role,
    initialLayout,
  });

  // Check if widget has data (used for layout filtering)
  const hasWidgetData = React.useCallback(
    (widgetId: WidgetId): boolean => {
      switch (widgetId) {
        case 'action-required':
          return !!data.actionRequired;
        case 'messages':
          return !!data.messages;
        case 'engagement':
          return !!data.engagementInsights;
        case 'my-rooms':
          return !!data.myRooms;
        case 'recent-activity':
          return !!data.recentActivity;
        case 'checklist-progress':
          return !!(data.checklistProgress && data.checklistProgress.length > 0);
        case 'continue-reading':
          return !!(data.continueReading && data.continueReading.length > 0);
        case 'bookmarks':
          return !!data.bookmarks;
        case 'new-documents':
          return !!data.newSinceLastVisit;
        case 'my-questions':
          return !!data.myQuestions;
        case 'announcements':
          return !!(data.announcements && data.announcements.length > 1);
        default:
          return false;
      }
    },
    [data]
  );

  // Filter layout to only include widgets with data
  const filteredLayout = React.useMemo(
    () => layout.filter((item) => hasWidgetData(item.i as WidgetId)),
    [layout, hasWidgetData]
  );

  // Render a widget by ID (returns null if data not available)
  const renderWidget = React.useCallback(
    (widgetId: WidgetId) => {
      switch (widgetId) {
        case 'action-required':
          if (!data.actionRequired) {
            return null;
          }
          return (
            <ActionRequiredWidget
              totalCount={data.actionRequired.totalCount}
              unansweredQuestions={data.actionRequired.unansweredQuestions}
              pendingAccessRequests={data.actionRequired.pendingAccessRequests}
              items={data.actionRequired.items}
            />
          );

        case 'messages':
          if (!data.messages) {
            return null;
          }
          return (
            <MessagesWidget
              unreadCount={data.messages.unreadCount}
              messages={data.messages.recent}
            />
          );

        case 'engagement':
          if (!data.engagementInsights) {
            return null;
          }
          return <EngagementWidget data={data.engagementInsights} />;

        case 'my-rooms':
          if (!data.myRooms) {
            return null;
          }
          return <MyRoomsWidget rooms={data.myRooms} />;

        case 'recent-activity':
          if (!data.recentActivity) {
            return null;
          }
          return <RecentActivityWidget activities={data.recentActivity} />;

        case 'checklist-progress':
          if (!data.checklistProgress || data.checklistProgress.length === 0) {
            return null;
          }
          return <ChecklistProgressWidget checklists={data.checklistProgress} />;

        case 'continue-reading':
          if (!data.continueReading || data.continueReading.length === 0) {
            return null;
          }
          return <ContinueReadingWidget items={data.continueReading} />;

        case 'bookmarks':
          if (!data.bookmarks) {
            return null;
          }
          return <BookmarksWidget bookmarks={data.bookmarks} />;

        case 'new-documents':
          if (!data.newSinceLastVisit) {
            return null;
          }
          return (
            <NewDocumentsWidget
              newDocuments={data.newSinceLastVisit.newDocuments}
              updatedDocuments={data.newSinceLastVisit.updatedDocuments}
            />
          );

        case 'my-questions':
          if (!data.myQuestions) {
            return null;
          }
          return <MyQuestionsWidget questions={data.myQuestions} />;

        case 'announcements':
          if (!data.announcements || data.announcements.length <= 1) {
            return null;
          }
          return <AnnouncementsWidget announcements={data.announcements.slice(1)} />;

        default:
          return null;
      }
    },
    [data]
  );

  return (
    <DashboardProvider
      initialCollapsed={Array.from(collapsedWidgets)}
      initialDensity={density}
      onCollapsedChange={(collapsed) => {
        collapsed.forEach((id) => {
          if (!collapsedWidgets.has(id)) {
            toggleCollapsed(id);
          }
        });
        Array.from(collapsedWidgets).forEach((id) => {
          if (!collapsed.includes(id)) {
            toggleCollapsed(id);
          }
        });
      }}
      onDensityChange={setDensity}
    >
      <div className="space-y-6">
        {/* Welcome banner for new users */}
        {data.myRooms && (
          <WelcomeBanner
            roomCount={data.myRooms.length}
            dismissed={welcomeBannerDismissed}
            onDismiss={dismissWelcomeBanner}
          />
        )}

        {/* Featured announcement */}
        {data.announcements && data.announcements.length > 0 && (
          <FeaturedAnnouncement announcement={data.announcements[0] ?? null} />
        )}

        {/* Dashboard controls (hidden on mobile) */}
        <DashboardControls onReset={resetLayout} isSaving={isSaving} />

        {/* Dashboard grid or mobile stack */}
        {isMobile ? (
          <MobileStackedDashboard role={role} renderWidget={renderWidget} />
        ) : (
          <DashboardGrid layout={filteredLayout} onLayoutChange={updateLayout}>
            {filteredLayout.map((item) => (
              <div key={item.i} className="h-full">
                {renderWidget(item.i as WidgetId)}
              </div>
            ))}
          </DashboardGrid>
        )}
      </div>
    </DashboardProvider>
  );
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function LoadingDashboard() {
  return (
    <div className="space-y-6">
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
    </div>
  );
}
