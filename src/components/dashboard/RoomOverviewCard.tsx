'use client';

import * as React from 'react';
import { FileText, Link2, MessageCircleQuestion } from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

export interface RoomOverview {
  id: string;
  name: string;
  description: string | null;
  status: string;
  myRole: 'ADMIN' | 'VIEWER';
  documentCount: number;
  viewerCount: number;
  questionCount: number;
  newDocumentCount: number;
}

interface RoomOverviewCardProps {
  room: RoomOverview;
  /** Most recently viewed document in this room, if any. */
  continueDocument?: { documentId: string; documentName: string };
}

const statusBadges: Record<string, string> = {
  DRAFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  ARCHIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
};

/**
 * One room, one card, one destination. The whole card links into the room's
 * documents; the body is a compact overview (role, freshness, size) so the
 * landing page can stay rooms-first without a separate room index.
 */
export function RoomOverviewCard({ room, continueDocument }: RoomOverviewCardProps) {
  const freshness =
    room.newDocumentCount > 0
      ? `${room.newDocumentCount} new document${room.newDocumentCount === 1 ? '' : 's'} since your last visit`
      : 'No changes since your last visit';

  return (
    <Link
      href={`/rooms/${room.id}`}
      className="group flex h-full flex-col rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all hover:border-primary-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-700"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={clsx(
            'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            room.myRole === 'ADMIN'
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
          )}
        >
          {room.myRole === 'ADMIN' ? 'Admin' : 'Viewer'}
        </span>
        {room.status !== 'ACTIVE' && (
          <span
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
              statusBadges[room.status] || statusBadges['DRAFT']
            )}
          >
            {room.status}
          </span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold text-neutral-900 group-hover:text-primary-700 dark:text-neutral-100 dark:group-hover:text-primary-300">
        {room.name}
      </h3>
      {room.description && (
        <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
          {room.description}
        </p>
      )}

      <p
        className={clsx(
          'mt-3 text-sm',
          room.newDocumentCount > 0
            ? 'font-medium text-primary-700 dark:text-primary-300'
            : 'text-neutral-500 dark:text-neutral-400'
        )}
      >
        {freshness}
      </p>

      {continueDocument && (
        <p className="mt-1 truncate text-sm text-neutral-600 dark:text-neutral-400">
          Continue: <span className="font-medium">{continueDocument.documentName}</span>
        </p>
      )}

      <div className="mt-auto flex items-center gap-4 pt-4 text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <FileText className="h-4 w-4" aria-hidden="true" />
          {room.documentCount} {room.documentCount === 1 ? 'document' : 'documents'}
        </span>
        <span className="flex items-center gap-1.5">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {room.viewerCount} {room.viewerCount === 1 ? 'shared link' : 'shared links'}
        </span>
        {room.questionCount > 0 && (
          <span className="flex items-center gap-1.5">
            <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
            {room.questionCount} open
          </span>
        )}
      </div>
    </Link>
  );
}
