'use client';

import * as React from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import Link from 'next/link';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { clsx } from 'clsx';
import { useDashboardContext } from './DashboardContext';

interface DashboardWidgetProps {
  title: string;
  icon?: React.ReactNode;
  badge?: number | string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
}

export function DashboardWidget({
  title,
  icon,
  badge,
  viewAllHref,
  viewAllLabel = 'View all',
  children,
  className,
  loading,
  empty,
  emptyMessage = 'No items to display',
}: DashboardWidgetProps) {
  const { editMode } = useDashboardContext();

  return (
    <Card
      className={clsx(
        'group flex h-full flex-col overflow-hidden border border-primary-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,255,0.94))] shadow-[0_18px_40px_-28px_rgba(15,23,42,0.42)] ring-1 ring-white/55 backdrop-blur-sm hover:border-primary-200 hover:shadow-[0_24px_48px_-28px_rgba(37,99,235,0.28)]',
        className
      )}
    >
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-primary-100/80 bg-gradient-to-r from-white via-white to-primary-100/75 pb-3 pt-4 dark:border-neutral-800 dark:from-neutral-900 dark:to-primary-950/25">
        <div className="flex items-center gap-3">
          {/* Drag handle - only visible in edit mode */}
          {editMode && (
            <div className="drag-handle cursor-grab text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          {icon && (
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary-100 bg-primary-50 text-primary-700 shadow-inner shadow-white/80 dark:border-primary-900/70 dark:bg-primary-950/40 dark:text-primary-300">
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              {title}
            </h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-400">Insight</p>
          </div>
          {badge !== undefined && badge !== 0 && (
            <span className="rounded-full border border-primary-200 bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 shadow-sm dark:border-primary-800 dark:bg-primary-900 dark:text-primary-300">
              {badge}
            </span>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="flex items-center gap-1 rounded-full border border-transparent bg-white/70 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:border-primary-100 hover:text-primary-700 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:text-primary-300"
          >
            {viewAllLabel}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(255,255,255,0.88))] pt-4 dark:bg-transparent">
        {loading ? (
          <WidgetSkeleton />
        ) : empty ? (
          <div className="flex h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/80 px-4 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-500">
            <span className="font-medium text-neutral-500 dark:text-neutral-400">All clear</span>
            <span className="mt-1 text-xs uppercase tracking-[0.18em]">{emptyMessage}</span>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-700" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-700" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Widget list item component for consistent styling
interface WidgetListItemProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  badgeColor?: 'neutral' | 'primary' | 'success' | 'warning' | 'error';
  href?: string;
  onClick?: () => void;
  timestamp?: string;
  rightContent?: React.ReactNode;
}

const badgeColors = {
  neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  primary: 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export function WidgetListItem({
  icon,
  title,
  subtitle,
  badge,
  badgeColor = 'neutral',
  href,
  onClick,
  timestamp,
  rightContent,
}: WidgetListItemProps) {
  const content = (
    <div className="flex items-center gap-3 py-2.5">
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-gradient-to-br from-neutral-50 to-white text-neutral-500 shadow-sm dark:border-neutral-700 dark:from-neutral-800 dark:to-neutral-900 dark:text-neutral-400">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </p>
        {subtitle && (
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && (
          <span
            className={clsx('rounded px-1.5 py-0.5 text-xs font-medium', badgeColors[badgeColor])}
          >
            {badge}
          </span>
        )}
        {timestamp && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{timestamp}</span>
        )}
        {rightContent}
      </div>
    </div>
  );

  const className =
    'block rounded-2xl border border-transparent bg-white/45 px-3 py-1.5 transition-all hover:-translate-y-0.5 hover:border-primary-100 hover:bg-white hover:shadow-md dark:bg-neutral-900/30 dark:hover:border-primary-900/50 dark:hover:bg-neutral-900/80';

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className={clsx(className, 'w-full text-left')}>
        {content}
      </button>
    );
  }

  return <div className="px-2">{content}</div>;
}
