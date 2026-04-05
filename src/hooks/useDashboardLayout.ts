'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { WidgetPosition, DashboardLayoutConfig } from '@/types/dashboard';
import { getDefaultLayout, normalizeLayout } from '@/lib/dashboard-defaults';

interface UseDashboardLayoutOptions {
  role: 'ADMIN' | 'VIEWER';
  initialLayout?: DashboardLayoutConfig | null;
}

interface UseDashboardLayoutReturn {
  /** Current desktop layout */
  layout: WidgetPosition[];
  /** Set of collapsed widget IDs */
  collapsedWidgets: Set<string>;
  /** Current density mode */
  density: 'compact' | 'cozy';
  /** Whether welcome banner is dismissed */
  welcomeBannerDismissed: boolean;
  /** Whether using default layout (no saved layout) */
  isDefault: boolean;
  /** Whether layout has unsaved changes */
  isDirty: boolean;
  /** Update the layout (from drag/resize) */
  updateLayout: (newLayout: WidgetPosition[]) => void;
  /** Toggle a widget's collapsed state */
  toggleCollapsed: (widgetId: string) => void;
  /** Set density mode */
  setDensity: (mode: 'compact' | 'cozy') => void;
  /** Dismiss welcome banner */
  dismissWelcomeBanner: () => void;
  /** Reset to default layout */
  resetLayout: () => void;
  /** Save current layout to server */
  saveLayout: () => Promise<void>;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Last save error */
  saveError: string | null;
}

/**
 * Hook for managing dashboard layout state and persistence.
 */
export function useDashboardLayout({
  role,
  initialLayout,
}: UseDashboardLayoutOptions): UseDashboardLayoutReturn {
  const defaultLayout = getDefaultLayout(role);

  // Layout state
  const [layout, setLayout] = useState<WidgetPosition[]>(
    initialLayout?.desktopLayout ?? defaultLayout
  );
  const [collapsedWidgets, setCollapsedWidgets] = useState<Set<string>>(
    new Set(initialLayout?.collapsedWidgets ?? [])
  );
  const [density, setDensityState] = useState<'compact' | 'cozy'>(
    initialLayout?.densityMode ?? 'cozy'
  );
  const [welcomeBannerDismissed, setWelcomeBannerDismissed] = useState(
    initialLayout?.welcomeBannerDismissed ?? false
  );

  // Track if using default
  const [isDefault, setIsDefault] = useState(!initialLayout);

  // Track dirty state
  const [isDirty, setIsDirty] = useState(false);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Debounce timer ref
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update layout from drag/resize
  const updateLayout = useCallback((newLayout: WidgetPosition[]) => {
    setLayout(newLayout);
    setIsDirty(true);
    setIsDefault(false);
  }, []);

  // Toggle collapsed state
  const toggleCollapsed = useCallback((widgetId: string) => {
    setCollapsedWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(widgetId)) {
        next.delete(widgetId);
      } else {
        next.add(widgetId);
      }
      return next;
    });
    setIsDirty(true);
  }, []);

  // Set density
  const setDensity = useCallback((mode: 'compact' | 'cozy') => {
    setDensityState(mode);
    setIsDirty(true);
  }, []);

  // Dismiss welcome banner
  const dismissWelcomeBanner = useCallback(() => {
    setWelcomeBannerDismissed(true);
    setIsDirty(true);
  }, []);

  // Reset to default
  const resetLayout = useCallback(() => {
    setLayout(defaultLayout);
    setCollapsedWidgets(new Set());
    setDensityState('cozy');
    setIsDefault(true);
    setIsDirty(true);
  }, [defaultLayout]);

  // Save layout to server
  const saveLayout = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      // Normalize layout before saving to fix any potential y-position corruption
      const normalizedLayout = normalizeLayout(layout);

      const response = await fetch('/api/dashboard/v2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          layout: {
            desktopLayout: normalizedLayout,
            collapsedWidgets: Array.from(collapsedWidgets),
            densityMode: density,
            welcomeBannerDismissed,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save layout');
      }

      setIsDirty(false);
      setIsDefault(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save layout');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [layout, collapsedWidgets, density, welcomeBannerDismissed]);

  // Auto-save when dirty (debounced)
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save (1 second debounce)
    saveTimeoutRef.current = setTimeout(() => {
      saveLayout().catch(() => {
        // Error is already captured in saveError state
      });
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isDirty, saveLayout]);

  return {
    layout,
    collapsedWidgets,
    density,
    welcomeBannerDismissed,
    isDefault,
    isDirty,
    updateLayout,
    toggleCollapsed,
    setDensity,
    dismissWelcomeBanner,
    resetLayout,
    saveLayout,
    isSaving,
    saveError,
  };
}
