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
  const { editMode, density } = useDashboardContext();
  const isCompact = density === 'compact';

  return (
    <Card
      className={clsx(
        'group flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-sm transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50',
        className
      )}
    >
      <CardHeader
        className={clsx(
          'flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-neutral-100 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800',
          isCompact ? 'pb-2.5 pt-3' : 'pb-3.5 pt-4'
        )}
      >
        <div className="flex items-center gap-3">
          {editMode && (
            <div className="drag-handle cursor-grab text-slate-400 transition-colors hover:text-slate-100">
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          {icon && (
            <span
              className={clsx(
                'flex items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
                isCompact ? 'h-9 w-9' : 'h-10 w-10'
              )}
            >
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              {title}
            </h3>
          </div>
          {badge !== undefined && badge !== 0 && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-900 dark:text-sky-300">
              {badge}
            </span>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="flex items-center gap-1 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            {viewAllLabel}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className={clsx('min-h-0 flex-1 overflow-auto', isCompact ? 'pt-3' : 'pt-4')}>
        {loading ? (
          <WidgetSkeleton />
        ) : empty ? (
          <div className="flex min-h-[5.5rem] flex-col justify-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-left text-sm dark:border-neutral-700 dark:bg-neutral-800">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">All clear</span>
            <span className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              {emptyMessage}
            </span>
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
  const { density } = useDashboardContext();
  const isCompact = density === 'compact';

  const content = (
    <div className={clsx('flex items-center gap-3', isCompact ? 'py-1.5' : 'py-2.5')}>
      {icon && (
        <div
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
            isCompact ? 'h-9 w-9' : 'h-10 w-10'
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </p>
        {subtitle && (
          <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">{subtitle}</p>
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
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{timestamp}</span>
        )}
        {rightContent}
      </div>
    </div>
  );

  const className =
    'block rounded-xl border border-neutral-200 bg-white px-3 py-1.5 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800';

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

  return <div className="px-1.5">{content}</div>;
}
