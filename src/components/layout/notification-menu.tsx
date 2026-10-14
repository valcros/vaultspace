'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  actionPath: string | null;
  isRead: boolean;
  createdAt: string;
}

interface InboxPage {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
}

export function NotificationMenu({
  organizationId,
  className = '',
}: {
  organizationId: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async (cursor: string | null = null) => {
    const requestGeneration = generation.current;
    setLoading(true);
    setError(null);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/users/me/notification-inbox${query}`, {
        credentials: 'include',
      });
      const data = (await response.json()) as InboxPage & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load notifications');
      if (requestGeneration !== generation.current) return;
      setItems((current) => (cursor ? [...current, ...data.items] : data.items));
      setUnreadCount(data.unreadCount);
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      if (requestGeneration !== generation.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not load notifications');
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    generation.current += 1;
    setOpen(false);
    setItems([]);
    setUnreadCount(0);
    setNextCursor(null);
    setError(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [organizationId, load]);

  const markRead = React.useCallback(async (notificationId?: string) => {
    const response = await fetch('/api/users/me/notification-inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(notificationId ? { notificationId } : { all: true }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update notifications');
    setUnreadCount(data.unreadCount);
    setItems((current) =>
      current.map((item) =>
        !notificationId || item.id === notificationId ? { ...item, isRead: true } : item
      )
    );
  }, []);

  const openItem = async (item: NotificationItem) => {
    if (!item.isRead) {
      try {
        await markRead(item.id);
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : 'Could not mark notification read'
        );
      }
    }
    if (item.actionPath) {
      setOpen(false);
      router.push(item.actionPath);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative ${className}`}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-semibold text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[min(24rem,calc(100vw-2rem))] p-2" align="end">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                void markRead().catch((updateError) =>
                  setError(
                    updateError instanceof Error
                      ? updateError.message
                      : 'Could not mark notifications read'
                  )
                );
              }}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {error && (
          <div role="alert" className="space-y-2 px-3 py-2 text-sm text-danger-700">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {loading && items.length === 0 ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-neutral-500"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading notifications
          </div>
        ) : items.length === 0 && !error ? (
          <p className="px-3 py-8 text-center text-sm text-neutral-500">No notifications yet.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto" aria-label="Notification list">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className={`block cursor-pointer whitespace-normal px-3 py-3 ${item.isRead ? '' : 'bg-primary-50/70 dark:bg-primary-950/20'}`}
                onSelect={(event) => {
                  event.preventDefault();
                  void openItem(item);
                }}
              >
                <p className="font-medium text-neutral-950 dark:text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                  {item.message}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </DropdownMenuItem>
            ))}
            {nextCursor && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loading}
                onClick={() => void load(nextCursor)}
              >
                {loading ? 'Loading more...' : 'Load more'}
              </Button>
            )}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/notifications">Notification preferences</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
