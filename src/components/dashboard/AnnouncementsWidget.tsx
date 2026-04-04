'use client';

import * as React from 'react';
import { Megaphone } from 'lucide-react';
import { DashboardWidget } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

interface Announcement {
  id: string;
  content: string;
  authorName: string;
  roomName: string;
  createdAt: string;
}

interface AnnouncementsWidgetProps {
  announcements: Announcement[];
  loading?: boolean;
}

export function AnnouncementsWidget({ announcements, loading }: AnnouncementsWidgetProps) {
  return (
    <DashboardWidget
      title="Announcements"
      icon={<Megaphone className="h-4 w-4" />}
      loading={loading}
      empty={announcements.length === 0}
      emptyMessage="No announcements"
    >
      <div className="space-y-3">
        {announcements.slice(0, 3).map((announcement, index) => (
          <div
            key={announcement.id}
            className={clsx(
              'rounded-lg border-l-4 border-primary-500 bg-primary-50 p-3 dark:bg-primary-900/20',
              index > 0 &&
                'border-l-neutral-300 bg-neutral-50 dark:border-l-neutral-600 dark:bg-neutral-700/30'
            )}
          >
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {announcement.content.length > 150
                ? `${announcement.content.slice(0, 150)}...`
                : announcement.content}
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span>
                {announcement.authorName} - {announcement.roomName}
              </span>
              <span>
                {formatDistanceToNow(new Date(announcement.createdAt), { addSuffix: true })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </DashboardWidget>
  );
}

// Featured announcement banner for important notices
export function FeaturedAnnouncement({ announcement }: { announcement: Announcement | null }) {
  if (!announcement) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50 to-primary-100 p-4 dark:border-primary-800 dark:from-primary-900/30 dark:to-primary-800/30">
      <div className="absolute right-0 top-0 h-full w-32 opacity-10">
        <Megaphone className="h-full w-full text-primary-600" />
      </div>
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            Announcement
          </span>
        </div>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">{announcement.content}</p>
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            From {announcement.authorName} in {announcement.roomName}
          </span>
          <span>{formatDistanceToNow(new Date(announcement.createdAt), { addSuffix: true })}</span>
        </div>
      </div>
    </div>
  );
}
