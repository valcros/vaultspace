'use client';

import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { clsx } from 'clsx';
import { useDashboardContext } from './DashboardContext';

interface VirtualWidgetListProps<T> {
  /** Items to render in the list */
  items: T[];
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Fixed height for the virtual list container (in pixels) */
  height: number;
  /** Estimated item height for virtualization (defaults to 48) */
  estimatedItemHeight?: number;
  /** Show empty state when no items */
  emptyMessage?: string;
  /** Additional class name for container */
  className?: string;
}

/**
 * Virtualized list component for widgets with many items (50+).
 * Uses react-virtuoso for efficient rendering of long lists.
 */
export function VirtualWidgetList<T>({
  items,
  renderItem,
  height,
  estimatedItemHeight = 48,
  emptyMessage = 'No items',
  className,
}: VirtualWidgetListProps<T>) {
  const { density } = useDashboardContext();

  // Adjust height based on density
  const adjustedHeight = density === 'compact' ? height * 0.85 : height;

  if (items.length === 0) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center text-sm text-neutral-400 dark:text-neutral-500',
          className
        )}
        style={{ height: adjustedHeight }}
      >
        {emptyMessage}
      </div>
    );
  }

  // For small lists, don't virtualize
  if (items.length < 20) {
    return (
      <div
        className={clsx('scrollbar-thin overflow-y-auto', className)}
        style={{ maxHeight: adjustedHeight }}
      >
        {items.map((item, index) => (
          <React.Fragment key={index}>{renderItem(item, index)}</React.Fragment>
        ))}
      </div>
    );
  }

  // Virtualize for larger lists
  return (
    <Virtuoso
      style={{ height: adjustedHeight }}
      totalCount={items.length}
      itemContent={(index) => {
        const item = items[index];
        if (!item) {
          return null;
        }
        return renderItem(item, index);
      }}
      defaultItemHeight={estimatedItemHeight}
      className={clsx('scrollbar-thin', className)}
    />
  );
}

/**
 * Simple scrollable container for widget content.
 * Use this for lists that don't need virtualization.
 */
interface ScrollableContentProps {
  /** Maximum height before scrolling (in pixels) */
  maxHeight: number;
  children: React.ReactNode;
  className?: string;
}

export function ScrollableContent({ maxHeight, children, className }: ScrollableContentProps) {
  const { density } = useDashboardContext();

  // Adjust height based on density
  const adjustedHeight = density === 'compact' ? maxHeight * 0.85 : maxHeight;

  return (
    <div
      className={clsx('scrollbar-thin overflow-y-auto', className)}
      style={{ maxHeight: adjustedHeight }}
    >
      {children}
    </div>
  );
}
