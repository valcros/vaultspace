'use client';

import * as React from 'react';
import { ChevronRight, ChevronDown, GripVertical } from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Card, type CardProps } from '@/components/ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useDashboardContext, useWidgetCollapsed } from './DashboardContext';
import type { WidgetId } from '@/types/dashboard';

interface DashboardWidgetV2Props {
  /** Unique widget identifier */
  widgetId: WidgetId;
  /** Widget title displayed in header */
  title: string;
  /** Optional icon to display before title */
  icon?: React.ReactNode;
  /** Optional badge count/text */
  badge?: number | string;
  /** Optional "View all" link href */
  viewAllHref?: string;
  /** Optional "View all" link label */
  viewAllLabel?: string;
  /** Elevation level for shadow */
  elevation?: CardProps['elevation'];
  /** Whether widget can be collapsed */
  collapsible?: boolean;
  /** Maximum content height before scrolling (in pixels) */
  maxContentHeight?: number;
  /** Widget content */
  children: React.ReactNode;
  /** Whether widget is loading */
  loading?: boolean;
  /** Whether widget has no content */
  empty?: boolean;
  /** Message to show when empty */
  emptyMessage?: string;
  /** Additional class name */
  className?: string;
}

export function DashboardWidgetV2({
  widgetId,
  title,
  icon,
  badge,
  viewAllHref,
  viewAllLabel = 'View all',
  elevation = 'medium',
  collapsible = true,
  maxContentHeight,
  children,
  loading = false,
  empty = false,
  emptyMessage = 'No items to display',
  className,
}: DashboardWidgetV2Props) {
  const { editMode, toggleCollapsed, density } = useDashboardContext();
  const isCollapsed = useWidgetCollapsed(widgetId);

  // Density-aware spacing
  const contentPadding = density === 'compact' ? 'px-4 pb-3' : 'px-5 pb-4';
  const headerPadding = density === 'compact' ? 'px-4 py-2' : 'px-5 py-3';

  // Content wrapper with optional scroll
  const contentStyle: React.CSSProperties = maxContentHeight
    ? { maxHeight: maxContentHeight, overflowY: 'auto' }
    : {};

  const headerContent = (
    <div className={clsx('flex w-full flex-row items-center justify-between', headerPadding)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Drag handle - only visible in edit mode */}
        {editMode && (
          <div className="drag-handle cursor-grab text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        {/* Collapse chevron */}
        {collapsible && (
          <CollapsibleTrigger asChild>
            <button
              onClick={(e) => {
                e.preventDefault();
                toggleCollapsed(widgetId);
              }}
              className="flex items-center justify-center rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
              aria-label={isCollapsed ? 'Expand widget' : 'Collapse widget'}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
        )}

        {/* Icon */}
        {icon && <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{icon}</span>}

        {/* Title */}
        <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h3>

        {/* Badge */}
        {badge !== undefined && badge !== 0 && (
          <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900 dark:text-primary-300">
            {badge}
          </span>
        )}
      </div>

      {/* View all link */}
      {viewAllHref && !isCollapsed && (
        <Link
          href={viewAllHref}
          className="ml-2 flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {viewAllLabel}
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );

  return (
    <Collapsible open={!isCollapsed} asChild>
      <Card
        elevation={elevation}
        className={clsx(
          'flex flex-col',
          editMode && 'ring-2 ring-primary-200 dark:ring-primary-800',
          className
        )}
      >
        {/* Tinted header */}
        <div
          className={clsx(
            'flex flex-row items-center',
            'bg-neutral-50 dark:bg-neutral-700/50',
            'border-b border-neutral-100 dark:border-neutral-700',
            'rounded-t-xl'
          )}
        >
          {headerContent}
        </div>

        {/* Collapsible content */}
        <CollapsibleContent>
          <div className={clsx(contentPadding, 'pt-3')}>
            {loading ? (
              <WidgetSkeleton />
            ) : empty ? (
              <div className="flex h-24 items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
                {emptyMessage}
              </div>
            ) : (
              <div style={contentStyle} className="scrollbar-thin">
                {children}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
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

/**
 * Widget list item component for consistent styling across widgets.
 */
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

export function WidgetListItemV2({
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
  const padding = density === 'compact' ? 'py-1.5' : 'py-2';

  const content = (
    <div className={clsx('flex items-center gap-3', padding)}>
      {icon && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
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
    'block rounded-lg px-2 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-700/50';

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
