'use client';

import * as React from 'react';
import {
  Upload,
  FolderPlus,
  List,
  LayoutGrid,
  ArrowUpDown,
  Columns3,
  Minus,
  Tag,
} from 'lucide-react';
import { PanelLeftClose, PanelLeftOpen, PanelLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CATEGORY_OPTIONS } from '@/lib/documentCategories';
import type { RoomViewMode } from '@/lib/rooms/navigationPreferenceKeys';

export type SortField = 'name' | 'size' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export interface DocumentToolbarProps {
  viewMode: RoomViewMode;
  setViewMode: (mode: RoomViewMode) => void;
  /** Whether the one-time list-mode hint dot should render on the toggle. */
  showListModeHint: boolean;
  dismissListModeHint: () => void;
  folderPaneOpen: boolean;
  toggleFolderPane: () => void;
  /** Focus-restore anchor for the mobile folder drawer sheet. */
  folderDrawerTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onOpenFolderDrawer: () => void;
  onUploadClick: () => void;
  onNewFolderClick: () => void;
  categoryFilter: string | null;
  onCategoryFilterChange: (category: string | null) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  visibleColumns: Record<string, boolean>;
  onVisibleColumnsChange: (columns: Record<string, boolean>) => void;
}

/**
 * Composed document toolbar for the room detail page. The whole row sits in a
 * single white card inset from the tinted identity plane so it reads as a
 * deliberate command surface, not a row of detached widgets. Primary cluster
 * (Upload, New Folder) keeps full button weight; secondary cluster (Category,
 * Sort) follows a thin separator and uses subtler chrome; right-side
 * utilities (density / columns / view-mode) are visually quieter still.
 */
export function DocumentToolbar({
  viewMode,
  setViewMode,
  showListModeHint,
  dismissListModeHint,
  folderPaneOpen,
  toggleFolderPane,
  folderDrawerTriggerRef,
  onOpenFolderDrawer,
  onUploadClick,
  onNewFolderClick,
  categoryFilter,
  onCategoryFilterChange,
  sortField,
  sortDir,
  onSortChange,
  compact,
  onCompactChange,
  visibleColumns,
  onVisibleColumnsChange,
}: DocumentToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-md ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:ring-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        {viewMode === 'list' && (
          <>
            {/* Mobile/tablet: open folder tree as a drawer. */}
            <Button
              ref={folderDrawerTriggerRef}
              size="sm"
              variant="outline"
              className="lg:hidden"
              onClick={onOpenFolderDrawer}
              aria-label="Open folder tree"
            >
              <PanelLeft className="h-4 w-4" />
              <span className="ml-2">Folders</span>
            </Button>
            {/* Desktop: collapse / reopen the persistent folder pane. */}
            <Button
              size="sm"
              variant="ghost"
              className="hidden lg:inline-flex"
              onClick={toggleFolderPane}
              aria-pressed={folderPaneOpen}
              aria-label={folderPaneOpen ? 'Collapse folder pane' : 'Expand folder pane'}
              title={folderPaneOpen ? 'Collapse folder pane' : 'Expand folder pane'}
            >
              {folderPaneOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
          </>
        )}
        <Button size="sm" onClick={onUploadClick}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Files
        </Button>
        <Button size="sm" variant="outline" onClick={onNewFolderClick}>
          <FolderPlus className="mr-2 h-4 w-4" />
          New Folder
        </Button>
        {/* Visual separator between primary actions and secondary
            browsing utilities. Hidden on mobile where the selects are
            also hidden. */}
        <div
          aria-hidden="true"
          className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block"
        />
        {/* SelectTrigger ships with `w-full` baked in, so the trigger
                fills its parent. Wrap each select in a fixed-width
                flex-none div so the row doesn't expand them and they sit
                inline with Upload / New Folder. Hidden on mobile to keep
                the primary action row to a single line. */}
        <div className="hidden w-[170px] sm:block">
          <Select
            value={categoryFilter ?? 'all'}
            onValueChange={(v) => onCategoryFilterChange(v === 'all' ? null : v)}
          >
            <SelectTrigger
              aria-label="Filter by category"
              className="h-10 rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <Tag className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Global sort — works in both grid and list view so the
                user has one mental model regardless of layout. The list
                view's sortable column headers stay as a power-user
                convenience but bind to the same sortField/sortDir. */}
        <div className="hidden w-[180px] sm:block">
          <Select
            value={`${sortField}:${sortDir}`}
            onValueChange={(v) => {
              const [field, dir] = v.split(':') as [SortField, SortDir];
              onSortChange(field, dir);
            }}
          >
            <SelectTrigger
              aria-label="Sort documents"
              className="h-10 rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name:asc">Name (A → Z)</SelectItem>
              <SelectItem value="name:desc">Name (Z → A)</SelectItem>
              <SelectItem value="createdAt:desc">Newest first</SelectItem>
              <SelectItem value="createdAt:asc">Oldest first</SelectItem>
              <SelectItem value="size:desc">Largest first</SelectItem>
              <SelectItem value="size:asc">Smallest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Compact toggle (list view only; hidden on mobile — not meaningful
            at single-column widths) */}
        {viewMode === 'list' && (
          <button
            onClick={() => {
              onCompactChange(!compact);
            }}
            className={`hidden rounded-md border p-1.5 transition-colors sm:block ${compact ? 'border-primary-200 bg-primary-50 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-600'}`}
            title={compact ? 'Standard density' : 'Compact density'}
            aria-label={compact ? 'Switch to standard density' : 'Switch to compact density'}
          >
            <Minus className="h-4 w-4" />
          </button>
        )}
        {/* Column picker (list view only; hidden on mobile — columns are
            auto-hidden below sm anyway) */}
        {viewMode === 'list' && (
          <div className="hidden sm:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md border border-transparent p-1.5 text-neutral-500 transition-colors hover:text-neutral-600"
                  title="Show/hide columns"
                  aria-label="Show or hide columns"
                >
                  <Columns3 className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[
                  { key: 'size', label: 'Size' },
                  { key: 'uploaded', label: 'Uploaded' },
                ].map((col) => (
                  <DropdownMenuItem
                    key={col.key}
                    onClick={() => {
                      const next = {
                        ...visibleColumns,
                        [col.key]: !visibleColumns[col.key],
                      };
                      onVisibleColumnsChange(next);
                    }}
                  >
                    <span
                      className={`mr-2 inline-block h-3 w-3 rounded-sm border ${visibleColumns[col.key] ? 'border-primary-500 bg-primary-500' : 'border-neutral-300'}`}
                    />
                    {col.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {/* View toggle. Active mode uses a primary tint + ring so the
              user can read the current view at a glance without parsing
              gray-on-gray shade differences. */}
        <div
          role="group"
          aria-label="Document view mode"
          className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
        >
          <button
            onClick={() => {
              setViewMode('list');
              dismissListModeHint();
            }}
            className={`relative rounded-md p-1.5 transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200 dark:bg-slate-950 dark:text-primary-200 dark:ring-primary-800'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
            aria-pressed={viewMode === 'list'}
            aria-label="List view"
            title="List view"
          >
            <List className="h-4 w-4" aria-hidden="true" />
            {showListModeHint && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-900"
              />
            )}
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === 'grid'
                ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200 dark:bg-slate-950 dark:text-primary-200 dark:ring-primary-800'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
            aria-pressed={viewMode === 'grid'}
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
