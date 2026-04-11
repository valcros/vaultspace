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
              'rounded-2xl border border-l-4 border-slate-700/75 border-l-sky-400 bg-slate-950/50 p-3',
              index > 0 && 'bg-slate-950/38 border-l-slate-500'
            )}
          >
            <p className="text-sm text-slate-200">
              {announcement.content.length > 150
                ? `${announcement.content.slice(0, 150)}...`
                : announcement.content}
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
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
    <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_24%),linear-gradient(120deg,rgba(15,23,42,0.98),rgba(30,41,59,0.95)_58%,rgba(37,99,235,0.75))] p-4 text-white shadow-[0_24px_48px_-32px_rgba(2,6,23,0.92)]">
      <div className="absolute right-0 top-0 h-full w-32 opacity-10">
        <Megaphone className="h-full w-full text-sky-100" />
      </div>
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-sky-200" />
          <span className="text-xs font-semibold uppercase tracking-wide text-sky-200">
            Announcement
          </span>
        </div>
        <p className="text-sm text-slate-100">{announcement.content}</p>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
          <span>
            From {announcement.authorName} in {announcement.roomName}
          </span>
          <span>{formatDistanceToNow(new Date(announcement.createdAt), { addSuffix: true })}</span>
        </div>
      </div>
    </div>
  );
}
