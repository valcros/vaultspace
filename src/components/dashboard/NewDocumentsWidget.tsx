'use client';

import * as React from 'react';
import { Sparkles, FilePlus, RefreshCw } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface DocumentSummary {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  folderPath?: string;
  createdAt: string;
  updatedAt?: string;
  isNew: boolean;
}

interface NewDocumentsWidgetProps {
  newDocuments: DocumentSummary[];
  updatedDocuments: DocumentSummary[];
  loading?: boolean;
}

export function NewDocumentsWidget({
  newDocuments,
  updatedDocuments,
  loading,
}: NewDocumentsWidgetProps) {
  const totalCount = newDocuments.length + updatedDocuments.length;

  // Combine and sort by date
  const allDocuments = [
    ...newDocuments.map((d) => ({ ...d, type: 'new' as const })),
    ...updatedDocuments.map((d) => ({ ...d, type: 'updated' as const })),
  ].sort((a, b) => {
    const dateA =
      a.type === 'updated' && a.updatedAt ? new Date(a.updatedAt) : new Date(a.createdAt);
    const dateB =
      b.type === 'updated' && b.updatedAt ? new Date(b.updatedAt) : new Date(b.createdAt);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <DashboardWidget
      title="Since Last Visit"
      icon={<Sparkles className="h-4 w-4" />}
      badge={totalCount > 0 ? totalCount : undefined}
      loading={loading}
      empty={allDocuments.length === 0}
      emptyMessage="No new or updated documents"
    >
      <div className="space-y-1">
        {allDocuments.slice(0, 6).map((doc) => (
          <WidgetListItem
            key={`${doc.type}-${doc.id}`}
            icon={
              doc.type === 'new' ? (
                <FilePlus className="h-4 w-4 text-green-500" />
              ) : (
                <RefreshCw className="h-4 w-4 text-blue-500" />
              )
            }
            title={doc.name}
            subtitle={doc.folderPath ? `${doc.roomName} / ${doc.folderPath}` : doc.roomName}
            badge={doc.type === 'new' ? 'New' : 'Updated'}
            badgeColor={doc.type === 'new' ? 'success' : 'primary'}
            href={`/rooms/${doc.roomId}/documents/${doc.id}`}
            timestamp={formatDistanceToNow(
              new Date(doc.type === 'updated' && doc.updatedAt ? doc.updatedAt : doc.createdAt),
              { addSuffix: true }
            )}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
