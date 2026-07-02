'use client';

import * as React from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import {
  AttentionStrip,
  YourWorkStrip,
  RoomOverviewCard,
  FeaturedAnnouncement,
} from '@/components/dashboard';
import type { AttentionChip, YourWorkItem, RoomOverview } from '@/components/dashboard';

// ---------------------------------------------------------------------------
// Types (subset of the API v2 response used by the rooms-first landing)
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
    latestAccessRequestRoomId?: string;
    items: Array<{
      id: string;
      type: 'question' | 'access_request' | 'review';
      roomId: string;
    }>;
  };
  messages?: {
    unreadCount: number;
  };
  myRooms?: RoomOverview[];
  continueReading?: Array<{
    documentId: string;
    documentName: string;
    roomId: string;
    roomName: string;
    lastViewedAt: string;
  }>;
  bookmarks?: Array<{
    id: string;
    documentId: string;
    documentName: string;
    roomId: string;
  }>;
  myQuestions?: Array<{
    id: string;
    status: 'OPEN' | 'ANSWERED' | 'CLOSED';
    roomId: string;
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
// Landing signal builders
// ---------------------------------------------------------------------------

function buildAttentionChips(data: DashboardV2Data): AttentionChip[] {
  const chips: AttentionChip[] = [];
  const action = data.actionRequired;

  if (action && action.unansweredQuestions > 0) {
    const firstQuestion = action.items.find((item) => item.type === 'question');
    chips.push({
      key: 'questions',
      label: `${action.unansweredQuestions} ${action.unansweredQuestions === 1 ? 'question awaits' : 'questions await'} your answer`,
      href: firstQuestion ? `/rooms/${firstQuestion.roomId}?manage=qa` : '/rooms',
      icon: 'question',
    });
  }

  if (action && action.pendingAccessRequests > 0) {
    chips.push({
      key: 'access-requests',
      label: `${action.pendingAccessRequests} access ${action.pendingAccessRequests === 1 ? 'request' : 'requests'} to review`,
      href: action.latestAccessRequestRoomId
        ? `/rooms/${action.latestAccessRequestRoomId}?manage=members`
        : '/rooms',
      icon: 'access',
    });
  }

  if (data.messages && data.messages.unreadCount > 0) {
    chips.push({
      key: 'inbox',
      label: `${data.messages.unreadCount} unread ${data.messages.unreadCount === 1 ? 'message' : 'messages'}`,
      href: '/messages',
      icon: 'inbox',
    });
  }

  return chips;
}

function buildYourWorkItems(data: DashboardV2Data): YourWorkItem[] {
  const items: YourWorkItem[] = [];

  const continueItem = data.continueReading?.[0];
  if (continueItem) {
    items.push({
      key: 'continue',
      label: 'Continue reading',
      detail: continueItem.documentName,
      href: `/rooms/${continueItem.roomId}`,
      icon: 'continue',
    });
  }

  const bookmarks = data.bookmarks ?? [];
  if (bookmarks.length > 0) {
    items.push({
      key: 'bookmarks',
      label: `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}`,
      href: `/rooms/${bookmarks[0]!.roomId}`,
      icon: 'bookmark',
    });
  }

  const openQuestions = (data.myQuestions ?? []).filter((q) => q.status === 'OPEN');
  if (openQuestions.length > 0) {
    items.push({
      key: 'my-questions',
      label: `${openQuestions.length} of your ${openQuestions.length === 1 ? 'question is' : 'questions are'} pending`,
      href: `/rooms/${openQuestions[0]!.roomId}?manage=qa`,
      icon: 'question',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Main component
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
        <LoadingLanding />
      </>
    );
  }

  const isAdmin = data.user.role === 'ADMIN';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const chips = buildAttentionChips(data);
  const workItems = buildYourWorkItems(data);
  const rooms = data.myRooms ?? [];
  const featuredAnnouncement = data.announcements?.[0] ?? null;
  const continueByRoom = new Map((data.continueReading ?? []).map((c) => [c.roomId, c]));

  return (
    <>
      <PageHeader
        variant="work"
        title={`${greeting}, ${data.user.name?.split(' ')[0] || 'there'}`}
        description={
          data.user.lastLoginAt
            ? `Last sign-in ${formatDistanceToNow(new Date(data.user.lastLoginAt), { addSuffix: true })}`
            : undefined
        }
        actions={
          isAdmin ? (
            <Link href="/rooms">
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New Room
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <AttentionStrip chips={chips} />
        <YourWorkStrip items={workItems} />
        <FeaturedAnnouncement announcement={featuredAnnouncement} />

        {rooms.length > 0 ? (
          <section aria-label="Your rooms">
            {/* With one or two rooms, let the cards breathe as wide overview
                panels; the compact 3-up grid only earns its keep at volume. */}
            <div
              className={
                rooms.length <= 2
                  ? 'grid max-w-4xl gap-4 md:grid-cols-1'
                  : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
              }
            >
              {rooms.map((room) => {
                const continueDoc = continueByRoom.get(room.id);
                return (
                  <RoomOverviewCard
                    key={room.id}
                    room={room}
                    continueDocument={
                      continueDoc
                        ? {
                            documentId: continueDoc.documentId,
                            documentName: continueDoc.documentName,
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </section>
        ) : (
          <EmptyRooms isAdmin={isAdmin} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty and loading states
// ---------------------------------------------------------------------------

function EmptyRooms({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <FolderOpen className="h-10 w-10 text-neutral-400" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        No rooms yet
      </h2>
      {isAdmin ? (
        <>
          <p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
            Create your first data room to start sharing documents securely.
          </p>
          <Link href="/rooms" className="mt-5">
            <Button>
              <Plus className="mr-1 h-4 w-4" />
              Create a room
            </Button>
          </Link>
        </>
      ) : (
        <p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
          You&apos;ll see rooms here as soon as you&apos;re added to one.
        </p>
      )}
    </div>
  );
}

function LoadingLanding() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-56 rounded-full" />
        <Skeleton className="h-8 w-44 rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-52 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
