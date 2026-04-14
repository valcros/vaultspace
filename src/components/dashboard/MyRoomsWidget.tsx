'use client';

import * as React from 'react';
import { FolderOpen, FileText, Users, HelpCircle } from 'lucide-react';
import Link from 'next/link';
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
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  ARCHIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  CLOSED: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
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
          <Link
            key={room.id}
            href={`/rooms/${room.id}`}
            className="group block rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-all hover:border-primary-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {index === 0 ? 'Start Here' : 'Available Room'}
                  </span>
                </div>
                <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.name}
                </p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
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

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.documentCount}
                </p>
              </div>
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <Users className="h-3.5 w-3.5" />
                  Viewers
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.viewerCount}
                </p>
              </div>
              <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Questions
                </div>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {room.questionCount}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm font-medium text-primary-600 dark:text-primary-400">
              <span>Open room</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </Link>
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
