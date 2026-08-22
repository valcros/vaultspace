'use client';

import * as React from 'react';
import Link from 'next/link';
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
import { clsx } from 'clsx';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationMenuProps {
  className?: string;
}

export function NotificationMenu({ className }: NotificationMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/users/me/notification-inbox', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load notifications');
      }
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = async (notificationId?: string) => {
    try {
      const response = await fetch('/api/users/me/notification-inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(notificationId ? { notificationId } : { all: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to update notifications');
      }
      setUnreadCount(data.unreadCount || 0);
      setItems((current) =>
        current.map((item) =>
          notificationId
            ? item.id === notificationId
              ? { ...item, isRead: true }
              : item
            : { ...item, isRead: true }
        )
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : 'Unable to update notifications'
      );
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          void load();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={clsx('relative', className)}
          aria-label={
            unreadCount > 0 ? `Notifications, ${Math.min(unreadCount, 99)} unread` : 'Notifications'
          }
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[min(24rem,calc(100vw-2rem))] p-2" align="end">
        <div className="flex items-center justify-between px-2 py-1">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => void markRead()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications
          </div>
        ) : error ? (
          <div className="space-y-3 px-3 py-5 text-sm text-danger-700 dark:text-danger-300">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-neutral-500">You’re all caught up.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className={clsx(
                  'block cursor-pointer whitespace-normal px-3 py-3',
                  !item.isRead && 'bg-primary-50/70 dark:bg-primary-950/20'
                )}
                onSelect={() => {
                  if (!item.isRead) {
                    void markRead(item.id);
                  }
                }}
              >
                <p className="font-medium text-neutral-950 dark:text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                  {item.message}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </DropdownMenuItem>
            ))}
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
