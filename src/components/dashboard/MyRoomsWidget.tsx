'use client';

import * as React from 'react';
import { FolderOpen, FileText, Users, HelpCircle } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { clsx } from 'clsx';

interface RoomSummary {
  id: string;
  name: string;
  status: string;
  documentCount: number;
  viewerCount: number;
  questionCount: number;
  lastActivity?: string;
}

interface MyRoomsWidgetProps {
  rooms: RoomSummary[];
  loading?: boolean;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  ARCHIVED: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  CLOSED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export function MyRoomsWidget({ rooms, loading }: MyRoomsWidgetProps) {
  return (
    <DashboardWidget
      title="My Rooms"
      icon={<FolderOpen className="h-4 w-4" />}
      viewAllHref="/rooms"
      loading={loading}
      empty={rooms.length === 0}
      emptyMessage="No rooms yet"
    >
      <div className="space-y-1">
        {rooms.slice(0, 5).map((room) => (
          <WidgetListItem
            key={room.id}
            icon={<FolderOpen className="h-4 w-4" />}
            title={room.name}
            subtitle={
              <span className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {room.documentCount}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {room.viewerCount}
                </span>
                {room.questionCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <HelpCircle className="h-3 w-3" />
                    {room.questionCount}
                  </span>
                )}
              </span>
            }
            badge={room.status}
            badgeColor={room.status === 'ACTIVE' ? 'success' : room.status === 'DRAFT' ? 'neutral' : 'warning'}
            href={`/rooms/${room.id}`}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}

// Compact version for sidebars
export function MyRoomsCompactWidget({ rooms, loading }: MyRoomsWidgetProps) {
  return (
    <DashboardWidget
      title="Rooms"
      icon={<FolderOpen className="h-4 w-4" />}
      viewAllHref="/rooms"
      loading={loading}
      empty={rooms.length === 0}
      emptyMessage="No rooms"
    >
      <ul className="space-y-2">
        {rooms.slice(0, 6).map((room) => (
          <li key={room.id}>
            <a
              href={`/rooms/${room.id}`}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/50"
            >
              <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                {room.name}
              </span>
              <span
                className={clsx(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  statusColors[room.status] || statusColors['DRAFT']
                )}
              >
                {room.status}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </DashboardWidget>
  );
}
