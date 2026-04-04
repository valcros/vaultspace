'use client';

import * as React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { DashboardWidget } from './DashboardWidget';
import Link from 'next/link';
import { clsx } from 'clsx';

interface ChecklistProgress {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  completedCount: number;
  totalCount: number;
  missingItems: string[];
}

interface ChecklistProgressWidgetProps {
  checklists: ChecklistProgress[];
  loading?: boolean;
}

export function ChecklistProgressWidget({ checklists, loading }: ChecklistProgressWidgetProps) {
  return (
    <DashboardWidget
      title="Checklist Progress"
      icon={<ClipboardCheck className="h-4 w-4" />}
      loading={loading}
      empty={checklists.length === 0}
      emptyMessage="No checklists to track"
    >
      <div className="space-y-4">
        {checklists.slice(0, 3).map((checklist) => {
          const progress = checklist.totalCount > 0
            ? Math.round((checklist.completedCount / checklist.totalCount) * 100)
            : 0;
          const isComplete = progress === 100;

          return (
            <div key={checklist.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <Link
                  href={`/rooms/${checklist.roomId}/checklists/${checklist.id}`}
                  className="text-sm font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100 dark:hover:text-primary-400"
                >
                  {checklist.name}
                </Link>
                <span
                  className={clsx(
                    'text-xs font-medium',
                    isComplete
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-neutral-500 dark:text-neutral-400'
                  )}
                >
                  {checklist.completedCount}/{checklist.totalCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-700">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all duration-500',
                      isComplete
                        ? 'bg-green-500'
                        : progress >= 50
                          ? 'bg-primary-500'
                          : 'bg-amber-500'
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-neutral-400">{progress}%</span>
              </div>
              {!isComplete && checklist.missingItems.length > 0 && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Missing: {checklist.missingItems.slice(0, 2).join(', ')}
                  {checklist.missingItems.length > 2 && ` +${checklist.missingItems.length - 2} more`}
                </p>
              )}
              <p className="text-xs text-neutral-400">{checklist.roomName}</p>
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}

// Compact progress bar for quick overview
export function ChecklistQuickProgress({ checklists }: { checklists: ChecklistProgress[] }) {
  const totalItems = checklists.reduce((sum, c) => sum + c.totalCount, 0);
  const completedItems = checklists.reduce((sum, c) => sum + c.completedCount, 0);
  const overallProgress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Overall Checklist Progress
        </span>
        <span className="text-sm font-semibold text-primary-600 dark:text-primary-400">
          {overallProgress}%
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-700">
        <div
          className="h-full rounded-full bg-primary-500 transition-all duration-500"
          style={{ width: `${overallProgress}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        {completedItems} of {totalItems} items completed across {checklists.length} checklists
      </p>
    </div>
  );
}
