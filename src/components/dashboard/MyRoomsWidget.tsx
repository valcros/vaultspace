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
  DRAFT: 'border border-slate-700 bg-slate-800/85 text-slate-200',
  ACTIVE: 'border border-emerald-400/20 bg-emerald-500/15 text-emerald-100',
  ARCHIVED: 'border border-amber-400/20 bg-amber-500/15 text-amber-100',
  CLOSED: 'border border-rose-400/20 bg-rose-500/15 text-rose-100',
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
            className="group block rounded-[1.25rem] border border-slate-700/75 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_22%),linear-gradient(180deg,rgba(15,23,42,0.72),rgba(2,6,23,0.82))] p-4 shadow-[0_20px_38px_-28px_rgba(2,6,23,0.92)] transition-all hover:-translate-y-1 hover:border-sky-400/20 hover:bg-slate-900/95 hover:shadow-[0_24px_42px_-24px_rgba(56,189,248,0.18)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="border-sky-400/18 bg-sky-500/12 flex h-9 w-9 items-center justify-center rounded-2xl border text-sky-100">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100/65">
                    {index === 0 ? 'Start Here' : 'Available Room'}
                  </span>
                </div>
                <p className="text-base font-semibold text-white">{room.name}</p>
                <p className="mt-1 text-sm text-slate-300">
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

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-400">
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center gap-1 text-slate-400">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-50">{room.documentCount}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center gap-1 text-slate-400">
                  <Users className="h-3.5 w-3.5" />
                  Viewers
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-50">{room.viewerCount}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center gap-1 text-slate-400">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Questions
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-50">{room.questionCount}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm font-medium text-sky-100">
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
