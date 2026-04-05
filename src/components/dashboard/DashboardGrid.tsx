'use client';

import * as React from 'react';
// react-grid-layout v2 has different exports than types suggest
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const RGL = require('react-grid-layout') as any;
const { GridLayout, useContainerWidth } = RGL;
import { clsx } from 'clsx';
import { useDashboardContext } from './DashboardContext';
import type { WidgetPosition } from '@/types/dashboard';

// Import react-grid-layout styles
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Type for layout items
type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
};

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

// Grid configuration constants
const ROW_HEIGHT = 60;
const MARGIN: readonly [number, number] = [16, 16];
const COLS = 12;
const CONTAINER_PADDING: readonly [number, number] = [0, 0];

// Import compactor from react-grid-layout for vertical compaction
const { verticalCompactor } = RGL;

export function DashboardGrid({ layout, onLayoutChange, children, className }: DashboardGridProps) {
  const { editMode, breakpoint, isMobile } = useDashboardContext();
  const { width, containerRef, mounted } = useContainerWidth();

  // Convert WidgetPosition[] to react-grid-layout Layout format
  const gridLayout: LayoutItem[] = React.useMemo(
    () =>
      layout.map((item) => ({
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
    (newLayout: LayoutItem[]) => {
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

  // react-grid-layout v2 API: use gridConfig and dragConfig objects
  const gridConfig = {
    cols: COLS,
    rowHeight: ROW_HEIGHT,
    margin: MARGIN,
    containerPadding: CONTAINER_PADDING,
  };

  const dragConfig = {
    enabled: isDraggable,
    handle: '.drag-handle',
  };

  const resizeConfig = {
    enabled: isResizable,
  };

  return (
    <div ref={containerRef} className={clsx('dashboard-grid', className)}>
      {mounted && width > 0 && (
        <GridLayout
          layout={gridLayout}
          width={width}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          compactor={verticalCompactor}
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
