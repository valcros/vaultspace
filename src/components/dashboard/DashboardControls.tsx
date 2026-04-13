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
        'mb-0 flex items-center justify-end gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900',
        className
      )}
    >
      {/* Save indicator */}
      {isSaving && <span className="mr-2 text-xs text-neutral-500 dark:text-neutral-400">Saving...</span>}

      {/* Density toggle - always visible at md+ */}
      <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-800">
        <button
          onClick={() => setDensity('compact')}
          className={clsx(
            'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
            density === 'compact'
              ? 'bg-neutral-100 text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
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
              ? 'bg-neutral-100 text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
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
          <div className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditMode(!editMode)}
            className={clsx(
              'gap-1.5 rounded-xl border px-3 transition-colors',
              editMode
                ? 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:border-primary-800 dark:text-primary-300'
                : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {editMode ? 'Done Editing' : 'Edit Layout'}
          </Button>

          {/* Reset button - only visible in edit mode */}
          {editMode && onReset && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="gap-1.5 rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
            >
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
      Dashboard customization is available on larger screens (1200px+)
    </div>
  );
}
