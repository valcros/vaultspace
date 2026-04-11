'use client';

import * as React from 'react';
import {
  ArrowRight,
  Compass,
  Eye,
  FileText,
  FolderOpen,
  MessageSquare,
  Plus,
  Sparkles,
} from 'lucide-react';
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

  // Use the layout from the API (server normalizes corrupted layouts)
  const initialLayout: DashboardLayoutConfig = {
    desktopLayout: data.layout.desktopLayout,
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
              <Button
                size="sm"
                className="bg-white/12 hover:bg-white/18 rounded-xl border border-white/20 text-white backdrop-blur-sm"
              >
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
          return !!data.actionRequired && data.actionRequired.totalCount > 0;
        case 'messages':
          return (
            !!data.messages && (data.messages.unreadCount > 0 || data.messages.recent.length > 0)
          );
        case 'engagement':
          return (
            !!data.engagementInsights &&
            (data.engagementInsights.totalViews > 0 ||
              data.engagementInsights.uniqueViewers > 0 ||
              data.engagementInsights.downloads > 0 ||
              data.engagementInsights.topDocuments.length > 0)
          );
        case 'my-rooms':
          return !!data.myRooms && data.myRooms.length > 0;
        case 'recent-activity':
          return !!data.recentActivity && data.recentActivity.length > 0;
        case 'checklist-progress':
          return !!(data.checklistProgress && data.checklistProgress.length > 0);
        case 'continue-reading':
          return !!(data.continueReading && data.continueReading.length > 0);
        case 'bookmarks':
          return !!data.bookmarks && data.bookmarks.length > 0;
        case 'new-documents':
          return (
            !!data.newSinceLastVisit &&
            (data.newSinceLastVisit.newDocuments.length > 0 ||
              data.newSinceLastVisit.updatedDocuments.length > 0)
          );
        case 'my-questions':
          return !!data.myQuestions && data.myQuestions.length > 0;
        case 'announcements':
          return !!(data.announcements && data.announcements.length > 1);
        default:
          return false;
      }
    },
    [data]
  );

  // Filter layout to only include widgets with data.
  // react-grid-layout handles vertical compaction via compactType="vertical".
  const filteredLayout = React.useMemo(() => {
    return layout.filter((item) => hasWidgetData(item.i as WidgetId));
  }, [layout, hasWidgetData]);

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
      <div className="space-y-7">
        <DashboardHero data={data} role={role} />

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

        <section className="ring-white/6 rounded-[2rem] border border-slate-700/80 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_18%),radial-gradient(circle_at_bottom_left,rgba(37,99,235,0.16),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.98)_18%,rgba(30,41,59,0.96)_100%)] p-4 shadow-[0_30px_72px_-42px_rgba(2,6,23,0.92)] ring-1 md:p-5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/85">
                Active Workspace
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Workloads, rooms, and movement in one view.
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                The cards below are intentionally structured to surface what needs attention and
                where to go next.
              </p>
            </div>
            <DashboardControls
              onReset={resetLayout}
              isSaving={isSaving}
              className="shadow-[0_18px_40px_-30px_rgba(2,6,23,0.95)]"
            />
          </div>

          {/* Dashboard grid or mobile stack */}
          {isMobile ? (
            <MobileStackedDashboard role={role} renderWidget={renderWidget} />
          ) : (
            <DashboardGrid layout={filteredLayout} onLayoutChange={updateLayout}>
              {filteredLayout.map((item) => (
                <div key={item.i} className="h-full overflow-hidden">
                  {renderWidget(item.i as WidgetId)}
                </div>
              ))}
            </DashboardGrid>
          )}
        </section>
      </div>
    </DashboardProvider>
  );
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function DashboardHero({ data, role }: { data: DashboardV2Data; role: 'ADMIN' | 'VIEWER' }) {
  const rooms = data.myRooms ?? [];
  const firstRoom = rooms[0] ?? null;
  const totalDocuments = rooms.reduce((sum, room) => sum + room.documentCount, 0);
  const totalQuestions = rooms.reduce((sum, room) => sum + room.questionCount, 0);
  const pendingActions = data.actionRequired?.totalCount ?? 0;
  const unreadMessages = data.messages?.unreadCount ?? 0;
  const totalViews = data.engagementInsights?.totalViews ?? 0;

  const spotlightRooms = rooms.slice(0, 3);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <Card
        className="overflow-hidden border-primary-200/60 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.22),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.92)_40%,rgba(37,99,235,0.86))] text-white shadow-[0_30px_70px_-34px_rgba(15,23,42,0.8)]"
        elevation="high"
      >
        <CardContent className="relative p-6 md:p-8">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),transparent_56%)]" />
          <div className="relative max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-50/90">
              <Sparkles className="h-3.5 w-3.5" />
              Command Center
            </div>
            <h2 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight md:text-[2.5rem]">
              {firstRoom
                ? `Jump straight into ${firstRoom.name}.`
                : 'Build your first secure room.'}
            </h2>
            <p className="text-primary-50/78 mt-3 max-w-xl text-sm leading-6 md:text-base">
              {firstRoom
                ? 'Use the dashboard as your launch point: open active rooms, triage the newest questions, and keep investor traffic moving without hunting through the navigation.'
                : 'Start from a room, not a blank grid. Create a room, upload your first documents, and invite reviewers from a single flow.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {firstRoom ? (
                <Link href={`/rooms/${firstRoom.id}`}>
                  <Button className="rounded-xl border border-amber-200/60 bg-gradient-to-r from-amber-300 via-orange-200 to-amber-100 text-slate-950 shadow-[0_18px_36px_-20px_rgba(251,191,36,0.58)] hover:from-amber-200 hover:via-orange-100 hover:to-amber-50">
                    Open {firstRoom.name}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : role === 'ADMIN' ? (
                <Link href="/rooms/new">
                  <Button className="rounded-xl border border-amber-200/60 bg-gradient-to-r from-amber-300 via-orange-200 to-amber-100 text-slate-950 shadow-[0_18px_36px_-20px_rgba(251,191,36,0.58)] hover:from-amber-200 hover:via-orange-100 hover:to-amber-50">
                    Create your first room
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : null}

              <Link href="/rooms">
                <Button
                  variant="outline"
                  className="hover:bg-white/14 rounded-xl border-white/20 bg-white/10 text-white hover:text-white"
                >
                  Browse all rooms
                </Button>
              </Link>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Rooms',
                  value: rooms.length,
                  icon: FolderOpen,
                  tone: 'from-white/16 to-white/8',
                },
                {
                  label: 'Documents',
                  value: totalDocuments,
                  icon: FileText,
                  tone: 'from-emerald-400/24 to-white/8',
                },
                {
                  label: 'Pending',
                  value: pendingActions,
                  icon: MessageSquare,
                  tone: 'from-amber-400/24 to-white/8',
                },
                {
                  label: 'Views (7d)',
                  value: totalViews,
                  icon: Eye,
                  tone: 'from-sky-400/24 to-white/8',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={`border-white/12 rounded-2xl border bg-gradient-to-br ${stat.tone} px-4 py-3 backdrop-blur-sm`}
                >
                  <div className="flex items-center gap-2 text-primary-100/80">
                    <stat.icon className="h-4 w-4" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                      {stat.label}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {stat.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card
        className="overflow-hidden border-primary-200/40 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.22),transparent_18%),linear-gradient(145deg,rgba(15,23,42,0.98),rgba(30,41,59,0.94)_42%,rgba(37,99,235,0.86))] text-white shadow-[0_30px_70px_-34px_rgba(15,23,42,0.7)] ring-1 ring-white/10 backdrop-blur-sm"
        elevation="high"
      >
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-100/90">
                Room Runway
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Your fastest path into live work.
              </h3>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-primary-50 shadow-inner shadow-white/10">
              <Compass className="h-5 w-5" />
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {spotlightRooms.length > 0 ? (
            spotlightRooms.map((room, index) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                className="border-white/12 from-white/16 to-white/6 hover:border-white/18 hover:bg-white/14 group block rounded-[1.25rem] border bg-gradient-to-br via-white/10 p-4 shadow-[0_18px_38px_-26px_rgba(2,6,23,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-24px_rgba(37,99,235,0.32)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-100/65">
                      {index === 0 ? 'Start Here' : 'Next Room'}
                    </p>
                    <p className="mt-2 text-base font-semibold text-white">{room.name}</p>
                    <p className="text-primary-100/78 mt-1 text-sm">
                      {room.documentCount} documents, {room.viewerCount} viewers,{' '}
                      {room.questionCount} open questions.
                    </p>
                  </div>
                  <span className="text-primary-100/60 transition-transform group-hover:translate-x-1 group-hover:text-white">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="border-white/18 bg-white/8 rounded-[1.25rem] border border-dashed p-5 text-sm text-primary-100/70">
              {role === 'ADMIN'
                ? 'No rooms yet. Create one from the command center and the dashboard will start guiding users into active deal spaces.'
                : 'No rooms have been shared with you yet.'}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
            <div className="border-white/12 rounded-2xl border bg-white/10 px-4 py-3 shadow-sm backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-100/60">
                Unread Messages
              </p>
              <p className="mt-2 text-xl font-semibold text-white">{unreadMessages}</p>
            </div>
            <div className="border-white/12 rounded-2xl border bg-white/10 px-4 py-3 shadow-sm backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-100/60">
                Questions
              </p>
              <p className="mt-2 text-xl font-semibold text-white">{totalQuestions}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden" elevation="high">
        <CardContent className="p-6 md:p-8">
          <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
            <div className="space-y-4">
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-12 w-3/4 rounded-2xl" />
              <Skeleton className="h-5 w-2/3 rounded-xl" />
              <div className="flex gap-3">
                <Skeleton className="h-10 w-40 rounded-xl" />
                <Skeleton className="h-10 w-28 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            </div>
            <Skeleton className="h-full min-h-[300px] rounded-[1.5rem]" />
          </div>
        </CardContent>
      </Card>

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
