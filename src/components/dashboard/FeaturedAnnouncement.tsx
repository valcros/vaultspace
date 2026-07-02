'use client';

import * as React from 'react';
import { Megaphone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Announcement {
  id: string;
  content: string;
  authorName: string;
  roomName: string;
  createdAt: string;
}

// Featured announcement banner for important notices. Lives in its own file
// so the landing can import it without dragging the legacy widget system
// into the route bundle.
export function FeaturedAnnouncement({ announcement }: { announcement: Announcement | null }) {
  if (!announcement) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-900 p-4 text-white shadow-sm">
      <div className="absolute right-0 top-0 h-full w-32 opacity-5">
        <Megaphone className="h-full w-full text-white" />
      </div>
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-slate-300" />
          <span className="text-xs font-medium text-slate-300">Announcement</span>
        </div>
        <p className="text-sm text-white">{announcement.content}</p>
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
