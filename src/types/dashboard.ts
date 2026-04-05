/**
 * Dashboard Layout Types
 *
 * Types for the customizable dashboard grid system using react-grid-layout.
 */

/**
 * Position and size of a widget in the grid.
 * Based on react-grid-layout's Layout type.
 */
export interface WidgetPosition {
  /** Widget identifier */
  i: string;
  /** X position in grid units (0-11 for 12-column grid) */
  x: number;
  /** Y position in grid units */
  y: number;
  /** Width in grid units */
  w: number;
  /** Height in grid units */
  h: number;
  /** Minimum width in grid units */
  minW?: number;
  /** Minimum height in grid units */
  minH?: number;
  /** Maximum width in grid units */
  maxW?: number;
  /** Maximum height in grid units */
  maxH?: number;
  /** Whether widget is static (not draggable/resizable) */
  static?: boolean;
}

/**
 * User's dashboard layout configuration.
 * Persisted per user+org+role.
 */
export interface DashboardLayoutConfig {
  /** Desktop layout for lg breakpoint (>=1200px, 12 columns) */
  desktopLayout: WidgetPosition[];
  /** IDs of collapsed widgets */
  collapsedWidgets: string[];
  /** Display density preference */
  densityMode: 'compact' | 'cozy';
  /** Whether welcome banner has been dismissed */
  welcomeBannerDismissed: boolean;
}

/**
 * All available widget IDs.
 * These map to dashboard widget components.
 */
export type WidgetId =
  | 'action-required'
  | 'messages'
  | 'engagement'
  | 'my-rooms'
  | 'recent-activity'
  | 'checklist-progress'
  | 'continue-reading'
  | 'bookmarks'
  | 'new-documents'
  | 'my-questions'
  | 'announcements';

/**
 * Widget metadata for the grid system.
 */
export interface WidgetMeta {
  id: WidgetId;
  title: string;
  /** Whether this widget is available for admin role */
  adminOnly?: boolean;
  /** Whether this widget is available for viewer role */
  viewerOnly?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
}

/**
 * API response for dashboard layout.
 */
export interface DashboardLayoutResponse {
  desktopLayout: WidgetPosition[];
  collapsedWidgets: string[];
  densityMode: 'compact' | 'cozy';
  welcomeBannerDismissed: boolean;
  /** True if using default layout (no saved layout exists) */
  isDefault: boolean;
}

/**
 * Dashboard context value for components.
 */
export interface DashboardContextValue {
  /** Whether edit mode (drag/resize) is active */
  editMode: boolean;
  /** Toggle edit mode */
  setEditMode: (editing: boolean) => void;
  /** Current density mode */
  density: 'compact' | 'cozy';
  /** Update density mode */
  setDensity: (density: 'compact' | 'cozy') => void;
  /** Set of collapsed widget IDs */
  collapsedWidgets: Set<string>;
  /** Toggle collapsed state for a widget */
  toggleCollapsed: (widgetId: string) => void;
  /** Whether current viewport is mobile (<768px) */
  isMobile: boolean;
  /** Current breakpoint */
  breakpoint: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Whether layout can be edited at current breakpoint */
  canEdit: boolean;
}
