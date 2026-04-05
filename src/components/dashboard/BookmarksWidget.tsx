'use client';

import * as React from 'react';
import { Bookmark, FileText } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface BookmarkItem {
  id: string;
  documentId: string;
  documentName: string;
  roomId: string;
  roomName: string;
  folderPath?: string;
  createdAt: string;
}

interface BookmarksWidgetProps {
  bookmarks: BookmarkItem[];
  loading?: boolean;
}

export function BookmarksWidget({ bookmarks, loading }: BookmarksWidgetProps) {
  return (
    <DashboardWidget
      title="Bookmarks"
      icon={<Bookmark className="h-4 w-4" />}
      loading={loading}
      empty={bookmarks.length === 0}
      emptyMessage="No bookmarked documents"
    >
      <div className="space-y-1">
        {bookmarks.slice(0, 5).map((bookmark) => (
          <WidgetListItem
            key={bookmark.id}
            icon={<FileText className="h-4 w-4" />}
            title={bookmark.documentName}
            subtitle={
              bookmark.folderPath
                ? `${bookmark.roomName} / ${bookmark.folderPath}`
                : bookmark.roomName
            }
            href={`/rooms/${bookmark.roomId}/documents/${bookmark.documentId}`}
            timestamp={formatDistanceToNow(new Date(bookmark.createdAt), { addSuffix: true })}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
