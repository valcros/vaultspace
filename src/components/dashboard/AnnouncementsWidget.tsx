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
              'rounded-xl border border-l-4 border-neutral-200 border-l-sky-500 bg-neutral-50 p-3 dark:border-neutral-700 dark:border-l-sky-400 dark:bg-neutral-800',
              index > 0 && 'border-l-neutral-300 dark:border-l-neutral-500'
            )}
          >
            <p className="text-sm text-neutral-700 dark:text-neutral-200">
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

// FeaturedAnnouncement moved to ./FeaturedAnnouncement.tsx so the landing
// route does not pull the legacy widget graph through this module.
export { FeaturedAnnouncement } from './FeaturedAnnouncement';
