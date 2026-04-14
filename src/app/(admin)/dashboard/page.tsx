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
import { clsx } from 'clsx';

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
  useDashboardContext,
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
                className="rounded-xl border border-white/20 bg-white/15 text-white hover:bg-white/25"
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

  const visibleWidgetIds = React.useMemo(
    () => filteredLayout.map((item) => item.i as WidgetId),
    [filteredLayout]
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

        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 md:p-5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-medium text-primary-600 dark:text-primary-400">
                Active Workspace
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                Workloads, rooms, and movement in one view.
              </h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                The cards below are intentionally structured to surface what needs attention and
                where to go next.
              </p>
            </div>
            <DashboardControls onReset={resetLayout} isSaving={isSaving} />
          </div>

          {/* Dashboard grid or mobile stack */}
          {isMobile ? (
            <MobileStackedDashboard role={role} renderWidget={renderWidget} />
          ) : (
            <DesktopWorkspace
              role={role}
              visibleWidgetIds={visibleWidgetIds}
              renderWidget={renderWidget}
              layout={filteredLayout}
              onLayoutChange={updateLayout}
            />
          )}
        </section>
      </div>
    </DashboardProvider>
  );
}

function DesktopWorkspace({
  role,
  visibleWidgetIds,
  renderWidget,
  layout,
  onLayoutChange,
}: {
  role: 'ADMIN' | 'VIEWER';
  visibleWidgetIds: WidgetId[];
  renderWidget: (widgetId: WidgetId) => React.ReactNode;
  layout: DashboardLayoutConfig['desktopLayout'];
  onLayoutChange: (layout: DashboardLayoutConfig['desktopLayout']) => void;
}) {
  const { editMode } = useDashboardContext();

  if (editMode) {
    return (
      <DashboardGrid layout={layout} onLayoutChange={onLayoutChange}>
        {layout.map((item) => (
          <div key={item.i} className="h-full overflow-hidden">
            {renderWidget(item.i as WidgetId)}
          </div>
        ))}
      </DashboardGrid>
    );
  }

  return (
    <CuratedDesktopWorkspace
      role={role}
      visibleWidgetIds={visibleWidgetIds}
      renderWidget={renderWidget}
    />
  );
}

function CuratedDesktopWorkspace({
  role,
  visibleWidgetIds,
  renderWidget,
}: {
  role: 'ADMIN' | 'VIEWER';
  visibleWidgetIds: WidgetId[];
  renderWidget: (widgetId: WidgetId) => React.ReactNode;
}) {
  const { density } = useDashboardContext();
  const uniqueIds = Array.from(new Set(visibleWidgetIds));
  const pool = new Set(uniqueIds);

  const takeFirst = (candidates: WidgetId[]) => {
    const match = candidates.find((id) => pool.has(id));
    if (!match) {
      return null;
    }
    pool.delete(match);
    return match;
  };

  const takeMany = (candidates: WidgetId[], limit: number) => {
    const items: WidgetId[] = [];
    for (const candidate of candidates) {
      if (items.length >= limit) {
        break;
      }
      if (pool.has(candidate)) {
        pool.delete(candidate);
        items.push(candidate);
      }
    }
    return items;
  };

  const adminPrimaryOrder: WidgetId[] = [
    'my-rooms',
    'recent-activity',
    'messages',
    'action-required',
    'new-documents',
    'engagement',
    'checklist-progress',
    'bookmarks',
    'continue-reading',
  ];
  const adminSecondaryOrder: WidgetId[] = [
    'recent-activity',
    'messages',
    'action-required',
    'new-documents',
    'engagement',
    'checklist-progress',
    'bookmarks',
    'continue-reading',
    'my-rooms',
  ];
  const adminRailOrder: WidgetId[] = [
    'action-required',
    'messages',
    'new-documents',
    'engagement',
    'checklist-progress',
    'bookmarks',
    'continue-reading',
  ];

  const viewerPrimaryOrder: WidgetId[] = [
    'my-rooms',
    'messages',
    'new-documents',
    'my-questions',
    'continue-reading',
    'bookmarks',
    'announcements',
  ];
  const viewerSecondaryOrder: WidgetId[] = [
    'messages',
    'new-documents',
    'my-questions',
    'continue-reading',
    'bookmarks',
    'announcements',
    'my-rooms',
  ];
  const viewerRailOrder: WidgetId[] = [
    'messages',
    'new-documents',
    'my-questions',
    'continue-reading',
    'bookmarks',
    'announcements',
  ];

  const primary = takeFirst(role === 'ADMIN' ? adminPrimaryOrder : viewerPrimaryOrder);
  const secondary = takeFirst(role === 'ADMIN' ? adminSecondaryOrder : viewerSecondaryOrder);
  const rail = takeMany(role === 'ADMIN' ? adminRailOrder : viewerRailOrder, 3);
  const remaining = uniqueIds.filter((id) => pool.has(id));

  const primaryNode = primary ? renderWidget(primary) : null;
  const secondaryNode = secondary ? renderWidget(secondary) : null;
  const railNodes = rail
    .map((id) => ({ id, node: renderWidget(id) }))
    .filter((item): item is { id: WidgetId; node: React.ReactNode } => Boolean(item.node));
  const remainingNodes = remaining
    .map((id) => ({ id, node: renderWidget(id) }))
    .filter((item): item is { id: WidgetId; node: React.ReactNode } => Boolean(item.node));

  return (
    <div className={density === 'compact' ? 'space-y-4' : 'space-y-6'}>
      {(primaryNode || secondaryNode) && (
        <div
          className={
            primaryNode && secondaryNode
              ? density === 'compact'
                ? 'grid gap-4 xl:grid-cols-[1.2fr_0.8fr]'
                : 'grid gap-6 xl:grid-cols-[1.2fr_0.8fr]'
              : density === 'compact'
                ? 'grid gap-4'
                : 'grid gap-6'
          }
        >
          {primaryNode && <div className="min-w-0">{primaryNode}</div>}
          {secondaryNode && <div className="min-w-0">{secondaryNode}</div>}
        </div>
      )}

      {railNodes.length > 0 && (
        <div
          className={
            railNodes.length === 1
              ? density === 'compact'
                ? 'grid gap-4'
                : 'grid gap-6'
              : railNodes.length === 2
                ? density === 'compact'
                  ? 'grid gap-4 xl:grid-cols-2'
                  : 'grid gap-6 xl:grid-cols-2'
                : density === 'compact'
                  ? 'grid gap-4 xl:grid-cols-3'
                  : 'grid gap-6 xl:grid-cols-3'
          }
        >
          {railNodes.map(({ id, node }) => (
            <div key={id} className="min-w-0">
              {node}
            </div>
          ))}
        </div>
      )}

      {remainingNodes.length > 0 && (
        <div className={clsx('grid xl:grid-cols-2', density === 'compact' ? 'gap-4' : 'gap-6')}>
          {remainingNodes.map(({ id, node }) => (
            <div key={id} className="min-w-0">
              {node}
            </div>
          ))}
        </div>
      )}

      {primaryNode === null &&
        secondaryNode === null &&
        railNodes.length === 0 &&
        remainingNodes.length === 0 && (
          <Card className="rounded-xl border border-neutral-200 bg-neutral-50 shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
            <CardContent className="p-8">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Workspace is quiet
              </p>
              <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
                There are no active tasks, messages, recent updates, or activity to surface right
                now. Use the command center above to jump into rooms or create new work.
              </p>
            </CardContent>
          </Card>
        )}
    </div>
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
      <Card className="overflow-hidden bg-slate-900 text-white shadow-md" elevation="high">
        <CardContent className="relative p-6 md:p-8">
          <div className="relative max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
              <Sparkles className="h-3.5 w-3.5" />
              Command Center
            </div>
            <h2 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight md:text-[2.5rem]">
              {firstRoom
                ? `Jump straight into ${firstRoom.name}.`
                : 'Build your first secure room.'}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 md:text-base">
              {firstRoom
                ? 'Use the dashboard as your launch point: open active rooms, triage the newest questions, and keep investor traffic moving without hunting through the navigation.'
                : 'Start from a room, not a blank grid. Create a room, upload your first documents, and invite reviewers from a single flow.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {firstRoom ? (
                <Link href={`/rooms/${firstRoom.id}`}>
                  <Button className="rounded-xl bg-primary-500 font-semibold text-white shadow-sm hover:bg-primary-600">
                    Open {firstRoom.name}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : role === 'ADMIN' ? (
                <Link href="/rooms/new">
                  <Button className="rounded-xl bg-primary-500 font-semibold text-white shadow-sm hover:bg-primary-600">
                    Create your first room
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : null}

              <Link href="/rooms">
                <Button
                  variant="outline"
                  className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                >
                  Browse all rooms
                </Button>
              </Link>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Rooms', value: rooms.length, icon: FolderOpen },
                { label: 'Documents', value: totalDocuments, icon: FileText },
                { label: 'Pending', value: pendingActions, icon: MessageSquare },
                { label: 'Views (7d)', value: totalViews, icon: Eye },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-slate-300">
                    <stat.icon className="h-4 w-4" />
                    <span className="text-xs font-medium">{stat.label}</span>
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

      <Card className="overflow-hidden bg-slate-900 text-white shadow-md" elevation="high">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-300">Room Runway</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Your fastest path into live work.
              </h3>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white">
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
                className="group block rounded-xl border border-white/15 bg-white/10 p-4 transition-colors hover:bg-white/15"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-300">
                      {index === 0 ? 'Start Here' : 'Next Room'}
                    </p>
                    <p className="mt-2 text-base font-semibold text-white">{room.name}</p>
                    <p className="mt-1 text-sm text-slate-300">
                      {room.documentCount} documents, {room.viewerCount} viewers,{' '}
                      {room.questionCount} open questions.
                    </p>
                  </div>
                  <span className="text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-white">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/20 bg-white/5 p-5 text-sm text-slate-300">
              {role === 'ADMIN'
                ? 'No rooms yet. Create one from the command center and the dashboard will start guiding users into active deal spaces.'
                : 'No rooms have been shared with you yet.'}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3">
              <p className="text-xs font-medium text-slate-300">Unread Messages</p>
              <p className="mt-2 text-xl font-semibold text-white">{unreadMessages}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3">
              <p className="text-xs font-medium text-slate-300">Questions</p>
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
