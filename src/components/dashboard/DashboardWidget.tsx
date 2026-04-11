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
        'ring-white/6 hover:border-sky-400/18 group flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.14),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.95)_24%,rgba(30,41,59,0.94)_100%)] text-slate-50 shadow-[0_26px_56px_-36px_rgba(2,6,23,0.92)] ring-1 backdrop-blur-sm hover:shadow-[0_30px_64px_-34px_rgba(14,165,233,0.22)]',
        className
      )}
    >
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-slate-700/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] pb-3 pt-4">
        <div className="flex items-center gap-3">
          {editMode && (
            <div className="drag-handle cursor-grab text-slate-500 transition-colors hover:text-slate-300">
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          {icon && (
            <span className="border-sky-400/18 bg-sky-500/12 flex h-10 w-10 items-center justify-center rounded-2xl border text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-slate-50">{title}</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Insight</p>
          </div>
          {badge !== undefined && badge !== 0 && (
            <span className="bg-sky-500/14 rounded-full border border-sky-400/20 px-2.5 py-1 text-xs font-semibold text-sky-100 shadow-[0_10px_24px_-18px_rgba(56,189,248,0.9)]">
              {badge}
            </span>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="hover:border-sky-400/18 flex items-center gap-1 rounded-full border border-slate-700/85 bg-slate-900/60 px-2.5 py-1 text-xs font-medium text-slate-300 transition-all hover:bg-slate-800/85 hover:text-sky-100"
          >
            {viewAllLabel}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01)_42%,rgba(15,23,42,0))] pt-4">
        {loading ? (
          <WidgetSkeleton />
        ) : empty ? (
          <div className="flex min-h-[5.5rem] flex-col justify-center rounded-2xl border border-slate-700/70 bg-slate-950/45 px-4 py-4 text-left text-sm text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <span className="font-medium text-slate-100">All clear</span>
            <span className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
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
  const content = (
    <div className="flex items-center gap-3 py-2.5">
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/70 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-50">{title}</p>
        {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && (
          <span
            className={clsx('rounded px-1.5 py-0.5 text-xs font-medium', badgeColors[badgeColor])}
          >
            {badge}
          </span>
        )}
        {timestamp && <span className="text-xs text-slate-500">{timestamp}</span>}
        {rightContent}
      </div>
    </div>
  );

  const className =
    'block rounded-2xl border border-transparent bg-slate-950/36 px-3 py-1.5 transition-all hover:-translate-y-0.5 hover:border-sky-400/18 hover:bg-slate-900/88 hover:shadow-[0_18px_30px_-24px_rgba(14,165,233,0.45)]';

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
