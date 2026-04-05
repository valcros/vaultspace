'use client';

import * as React from 'react';
import { LayoutGrid, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { useDashboardContext } from './DashboardContext';

interface DashboardControlsProps {
  /** Callback to reset layout to defaults */
  onReset?: () => void;
  /** Whether layout is currently being saved */
  isSaving?: boolean;
  /** Additional class name */
  className?: string;
}

export function DashboardControls({ onReset, isSaving, className }: DashboardControlsProps) {
  const { editMode, setEditMode, density, setDensity, canEdit, breakpoint } = useDashboardContext();

  // Hide controls entirely on mobile
  if (breakpoint === 'xs' || breakpoint === 'sm') {
    return null;
  }

  return (
    <div
      className={clsx(
        'flex items-center justify-end gap-2 mb-4',
        'py-2 px-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50',
        className
      )}
    >
      {/* Save indicator */}
      {isSaving && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-2">Saving...</span>
      )}

      {/* Density toggle - always visible at md+ */}
      <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
        <button
          onClick={() => setDensity('compact')}
          className={clsx(
            'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
            density === 'compact'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          )}
          aria-label="Compact density"
        >
          <Minimize2 className="h-3 w-3" />
          <span className="hidden sm:inline">Compact</span>
        </button>
        <button
          onClick={() => setDensity('cozy')}
          className={clsx(
            'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
            density === 'cozy'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          )}
          aria-label="Cozy density"
        >
          <Maximize2 className="h-3 w-3" />
          <span className="hidden sm:inline">Cozy</span>
        </button>
      </div>

      {/* Edit mode toggle - only visible at lg breakpoint */}
      {canEdit && (
        <>
          <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-1" />

          <Button
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode(!editMode)}
            className="gap-1.5"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {editMode ? 'Done Editing' : 'Edit Layout'}
          </Button>

          {/* Reset button - only visible in edit mode */}
          {editMode && onReset && (
            <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5 text-neutral-500">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Edit mode indicator that shows on mobile when not supported.
 */
export function EditModeNotice() {
  const { breakpoint } = useDashboardContext();

  // Only show on md breakpoint (tablet)
  if (breakpoint !== 'md') {
    return null;
  }

  return (
    <div className="text-center py-2 px-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
      Dashboard customization is available on larger screens (1200px+)
    </div>
  );
}
