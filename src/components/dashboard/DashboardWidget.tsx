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
        'ring-white/6 group flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-slate-500/90 bg-slate-900 text-slate-50 shadow-[0_22px_44px_-32px_rgba(2,6,23,0.9)] ring-1 transition-colors hover:border-sky-300/20',
        className
      )}
    >
      <CardHeader
        className={clsx(
          'flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-slate-500/90 bg-slate-900',
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
                'bg-sky-400/12 flex items-center justify-center rounded-2xl border border-sky-300/20 text-sky-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
                isCompact ? 'h-9 w-9' : 'h-10 w-10'
              )}
            >
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-200">Insight</p>
          </div>
          {badge !== undefined && badge !== 0 && (
            <span className="bg-sky-400/16 rounded-full border border-sky-300/25 px-2.5 py-1 text-xs font-semibold text-sky-50">
              {badge}
            </span>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="flex items-center gap-1 rounded-full border border-slate-600/85 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 transition-all hover:border-sky-300/20 hover:bg-slate-700 hover:text-white"
          >
            {viewAllLabel}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent
        className={clsx('min-h-0 flex-1 overflow-auto bg-slate-900', isCompact ? 'pt-3' : 'pt-4')}
      >
        {loading ? (
          <WidgetSkeleton />
        ) : empty ? (
          <div className="flex min-h-[5.5rem] flex-col justify-center rounded-2xl border border-slate-500/80 bg-slate-950 px-4 py-4 text-left text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <span className="font-medium text-white">All clear</span>
            <span className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-200">
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
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-800" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-slate-800/80" />
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
  neutral: 'border border-slate-700 bg-slate-800/80 text-slate-200',
  primary: 'border border-sky-400/20 bg-sky-500/15 text-sky-100',
  success: 'border border-emerald-400/20 bg-emerald-500/15 text-emerald-100',
  warning: 'border border-amber-400/20 bg-amber-500/15 text-amber-100',
  error: 'border border-rose-400/25 bg-rose-500/15 text-rose-100',
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
            'bg-slate-950/82 flex shrink-0 items-center justify-center rounded-2xl border border-slate-600/75 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
            isCompact ? 'h-9 w-9' : 'h-10 w-10'
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        {subtitle && <p className="truncate text-xs text-slate-200">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && (
          <span
            className={clsx('rounded px-1.5 py-0.5 text-xs font-medium', badgeColors[badgeColor])}
          >
            {badge}
          </span>
        )}
        {timestamp && <span className="text-xs text-slate-200">{timestamp}</span>}
        {rightContent}
      </div>
    </div>
  );

  const className =
    'block rounded-2xl border border-slate-600/55 bg-slate-950 px-3 py-1.5 transition-all hover:border-sky-300/18 hover:bg-slate-900';

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
