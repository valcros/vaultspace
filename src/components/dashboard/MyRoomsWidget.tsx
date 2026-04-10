'use client';

import * as React from 'react';
import { FolderOpen, FileText, Users, HelpCircle } from 'lucide-react';
import { DashboardWidget } from './DashboardWidget';
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
      title="Room Index"
      icon={<FolderOpen className="h-4 w-4" />}
      viewAllHref="/rooms"
      viewAllLabel="Browse rooms"
      loading={loading}
      empty={rooms.length === 0}
      emptyMessage="No rooms yet"
    >
      <div className="space-y-3">
        {rooms.slice(0, 4).map((room, index) => (
          <a
            key={room.id}
            href={`/rooms/${room.id}`}
            className="group block rounded-[1.25rem] border border-primary-100/90 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.16),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.92))] p-4 shadow-[0_18px_38px_-24px_rgba(15,23,42,0.26)] transition-all hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_22px_42px_-22px_rgba(37,99,235,0.32)] dark:border-neutral-700 dark:from-neutral-900 dark:via-neutral-900 dark:to-primary-950/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-900/60 dark:text-primary-300">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                    {index === 0 ? 'Start Here' : 'Available Room'}
                  </span>
                </div>
                <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.name}
                </p>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {room.status === 'ACTIVE'
                    ? 'Open the room to review documents, questions, and recent activity.'
                    : 'This room is available but not currently active.'}
                </p>
              </div>
              <span
                className={clsx(
                  'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
                  statusColors[room.status] || statusColors['DRAFT']
                )}
              >
                {room.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <div className="bg-white/92 rounded-xl border border-white/80 px-3 py-2 shadow-sm dark:bg-neutral-800/70">
                <div className="flex items-center gap-1 text-neutral-400">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.documentCount}
                </p>
              </div>
              <div className="bg-white/92 rounded-xl border border-white/80 px-3 py-2 shadow-sm dark:bg-neutral-800/70">
                <div className="flex items-center gap-1 text-neutral-400">
                  <Users className="h-3.5 w-3.5" />
                  Viewers
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.viewerCount}
                </p>
              </div>
              <div className="bg-white/92 rounded-xl border border-white/80 px-3 py-2 shadow-sm dark:bg-neutral-800/70">
                <div className="flex items-center gap-1 text-neutral-400">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Questions
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.questionCount}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm font-medium text-primary-700 dark:text-primary-300">
              <span>Open room</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </a>
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
