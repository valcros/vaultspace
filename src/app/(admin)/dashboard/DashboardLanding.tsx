'use client';

import * as React from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
// Direct file imports (not the barrel) so the client bundle only carries the
// landing strips, never the mothballed widget system re-exported elsewhere.
import { AttentionStrip } from '@/components/dashboard/AttentionStrip';
import type { AttentionChip } from '@/components/dashboard/AttentionStrip';
import { YourWorkStrip } from '@/components/dashboard/YourWorkStrip';
import type { YourWorkItem } from '@/components/dashboard/YourWorkStrip';
import { RoomOverviewCard } from '@/components/dashboard/RoomOverviewCard';
import type { RoomOverview } from '@/components/dashboard/RoomOverviewCard';
import { FeaturedAnnouncement } from '@/components/dashboard/FeaturedAnnouncement';
import { VaultTombstone } from '@/components/dashboard/VaultTombstone';

// ---------------------------------------------------------------------------
// Types (subset of the dashboard data used by the rooms-first landing)
// ---------------------------------------------------------------------------

export interface DashboardV2Data {
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
      href: `/rooms/${continueItem.roomId}?doc=${continueItem.documentId}`,
      icon: 'continue',
    });
  }

  const bookmarks = data.bookmarks ?? [];
  if (bookmarks.length > 0) {
    items.push({
      key: 'bookmarks',
      label: `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}`,
      href: `/rooms/${bookmarks[0]!.roomId}?doc=${bookmarks[0]!.documentId}`,
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

export function DashboardLanding({ data }: { data: DashboardV2Data }) {
  const isAdmin = data.user.role === 'ADMIN';
  // The time-of-day greeting must not be computed during SSR: the server
  // clock is UTC while the visitor's is local, so rendering it produced a
  // guaranteed hydration text mismatch (React #418) for any non-UTC user —
  // invisible in CI where both sides run UTC. Render a stable salutation on
  // the server and first client paint, then upgrade after mount.
  const [greeting, setGreeting] = React.useState('Welcome back');
  React.useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  }, []);

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
        {/* Actionable signals stay above the static identity plaque; the
            tombstone must never outrank live work (Advisor pre-mortem). */}
        <AttentionStrip chips={chips} />
        <YourWorkStrip items={workItems} />
        <FeaturedAnnouncement announcement={featuredAnnouncement} />
        <VaultTombstone
          roomCount={rooms.length}
          documentCount={rooms.reduce((sum, r) => sum + r.documentCount, 0)}
          linkCount={rooms.reduce((sum, r) => sum + r.viewerCount, 0)}
        />

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
// Empty state
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
