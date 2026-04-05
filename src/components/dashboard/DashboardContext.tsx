'use client';

import * as React from 'react';
import { useBreakpoint, useIsMobile } from '@/hooks/useMediaQuery';
import type { DashboardContextValue } from '@/types/dashboard';

const DashboardContext = React.createContext<DashboardContextValue | null>(null);

interface DashboardProviderProps {
  children: React.ReactNode;
  /** Initial collapsed widgets from server */
  initialCollapsed?: string[];
  /** Initial density mode from server */
  initialDensity?: 'compact' | 'cozy';
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsedWidgets: string[]) => void;
  /** Callback when density changes */
  onDensityChange?: (density: 'compact' | 'cozy') => void;
}

export function DashboardProvider({
  children,
  initialCollapsed = [],
  initialDensity = 'cozy',
  onCollapsedChange,
  onDensityChange,
}: DashboardProviderProps) {
  const [editMode, setEditMode] = React.useState(false);
  const [density, setDensityState] = React.useState<'compact' | 'cozy'>(initialDensity);
  const [collapsedWidgets, setCollapsedWidgets] = React.useState<Set<string>>(
    () => new Set(initialCollapsed)
  );

  const isMobile = useIsMobile();
  const breakpoint = useBreakpoint();

  // Edit mode is only allowed at lg breakpoint
  const canEdit = breakpoint === 'lg';

  // Disable edit mode if breakpoint changes to smaller
  React.useEffect(() => {
    if (!canEdit && editMode) {
      setEditMode(false);
    }
  }, [canEdit, editMode]);

  const toggleCollapsed = React.useCallback(
    (widgetId: string) => {
      setCollapsedWidgets((prev) => {
        const next = new Set(prev);
        if (next.has(widgetId)) {
          next.delete(widgetId);
        } else {
          next.add(widgetId);
        }
        onCollapsedChange?.(Array.from(next));
        return next;
      });
    },
    [onCollapsedChange]
  );

  const setDensity = React.useCallback(
    (newDensity: 'compact' | 'cozy') => {
      setDensityState(newDensity);
      onDensityChange?.(newDensity);
    },
    [onDensityChange]
  );

  const value: DashboardContextValue = React.useMemo(
    () => ({
      editMode,
      setEditMode,
      density,
      setDensity,
      collapsedWidgets,
      toggleCollapsed,
      isMobile,
      breakpoint,
      canEdit,
    }),
    [
      editMode,
      density,
      setDensity,
      collapsedWidgets,
      toggleCollapsed,
      isMobile,
      breakpoint,
      canEdit,
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext(): DashboardContextValue {
  const context = React.useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboardContext must be used within a DashboardProvider');
  }
  return context;
}

/**
 * Hook to check if a widget is collapsed.
 */
export function useWidgetCollapsed(widgetId: string): boolean {
  const { collapsedWidgets } = useDashboardContext();
  return collapsedWidgets.has(widgetId);
}

/**
 * Hook to get density-aware padding classes.
 */
export function useDensityClasses(): { padding: string; gap: string } {
  const { density } = useDashboardContext();

  return React.useMemo(() => {
    if (density === 'compact') {
      return {
        padding: 'p-3',
        gap: 'gap-2',
      };
    }
    return {
      padding: 'p-4',
      gap: 'gap-3',
    };
  }, [density]);
}
