'use client';

import * as React from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface ContinueReadingItem {
  documentId: string;
  documentName: string;
  roomId: string;
  roomName: string;
  lastPage?: number;
  totalPages?: number;
  lastViewedAt: string;
  thumbnailUrl?: string;
}

interface ContinueReadingWidgetProps {
  items: ContinueReadingItem[];
  loading?: boolean;
}

export function ContinueReadingWidget({ items, loading }: ContinueReadingWidgetProps) {
  return (
    <DashboardWidget
      title="Continue Reading"
      icon={<BookOpen className="h-4 w-4" />}
      loading={loading}
      empty={items.length === 0}
      emptyMessage="Start reading documents to see them here"
    >
      <div className="space-y-1">
        {items.slice(0, 5).map((item) => (
          <WidgetListItem
            key={item.documentId}
            icon={<FileText className="h-4 w-4" />}
            title={item.documentName}
            subtitle={
              <span>
                {item.roomName}
                {item.lastPage && item.totalPages && (
                  <span className="ml-2 text-primary-600 dark:text-primary-400">
                    Page {item.lastPage}/{item.totalPages}
                  </span>
                )}
                {item.lastPage && !item.totalPages && (
                  <span className="ml-2 text-primary-600 dark:text-primary-400">
                    Page {item.lastPage}
                  </span>
                )}
              </span>
            }
            href={`/rooms/${item.roomId}/documents/${item.documentId}${item.lastPage ? `?page=${item.lastPage}` : ''}`}
            timestamp={formatDistanceToNow(new Date(item.lastViewedAt), { addSuffix: true })}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
