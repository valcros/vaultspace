'use client';

import * as React from 'react';
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import { clsx } from 'clsx';
import { useDashboardContext } from './DashboardContext';
import type { WidgetPosition } from '@/types/dashboard';

// Import react-grid-layout styles
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

interface DashboardGridProps {
  /** Desktop layout (lg breakpoint) */
  layout: WidgetPosition[];
  /** Callback when layout changes */
  onLayoutChange: (layout: WidgetPosition[]) => void;
  /** Widget components keyed by widget ID */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
}

const ROW_HEIGHT = 60;
const MARGIN: [number, number] = [16, 16];
const COLS = 12;

export function DashboardGrid({ layout, onLayoutChange, children, className }: DashboardGridProps) {
  const { editMode, breakpoint, isMobile } = useDashboardContext();
  const { width, containerRef, mounted } = useContainerWidth();

  // Convert WidgetPosition[] to react-grid-layout Layout format
  const gridLayout: Layout = React.useMemo(
    () =>
      layout.map((item): LayoutItem => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        minH: item.minH,
        maxW: item.maxW,
        maxH: item.maxH,
        static: item.static,
      })),
    [layout]
  );

  // Handle layout change from drag/resize
  const handleLayoutChange = React.useCallback(
    (newLayout: Layout) => {
      const updatedLayout: WidgetPosition[] = newLayout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        minH: item.minH,
        maxW: item.maxW,
        maxH: item.maxH,
        static: item.static,
      }));
      onLayoutChange(updatedLayout);
    },
    [onLayoutChange]
  );

  // Don't render grid on mobile - use MobileStackedDashboard instead
  if (isMobile) {
    return null;
  }

  // Only allow drag/resize at lg breakpoint AND in edit mode
  const isLargeBreakpoint = breakpoint === 'lg' || breakpoint === 'xl' || breakpoint === '2xl';
  const isDraggable = editMode && isLargeBreakpoint;
  const isResizable = editMode && isLargeBreakpoint;

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>} className={clsx('dashboard-grid', className)}>
      {mounted && width > 0 && (
        <GridLayout
          layout={gridLayout}
          width={width}
          gridConfig={{
            cols: COLS,
            rowHeight: ROW_HEIGHT,
            margin: MARGIN,
            containerPadding: [0, 0],
            maxRows: Infinity,
          }}
          dragConfig={{
            enabled: isDraggable,
            bounded: false,
            handle: '.drag-handle',
            threshold: 3,
          }}
          resizeConfig={{
            enabled: isResizable,
            handles: ['se'],
          }}
          onLayoutChange={handleLayoutChange}
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}

/**
 * Wrapper for a widget that provides the grid item key.
 * Must wrap each widget in the DashboardGrid.
 */
interface GridWidgetProps {
  /** Widget ID matching the layout */
  widgetId: string;
  children: React.ReactNode;
}

export function GridWidget({ widgetId, children }: GridWidgetProps) {
  return (
    <div key={widgetId} className="h-full">
      {children}
    </div>
  );
}
