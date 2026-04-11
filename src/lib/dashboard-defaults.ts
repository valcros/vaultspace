/**
 * Default Dashboard Layouts
 *
 * Role-specific default widget layouts for the dashboard grid.
 * These are used when a user has no saved layout configuration.
 *
 * Grid specs:
 * - 12 columns at lg breakpoint (>=1200px)
 * - react-grid-layout auto-calculates md/sm/xs from lg layout
 * - Row height is 60px with 16px margin
 */

import type { WidgetPosition, WidgetId } from '@/types/dashboard';

export const CURRENT_DASHBOARD_LAYOUT_VERSION = 2;

/**
 * Admin default layout (11 widgets).
 * Optimized for organization management and oversight.
 */
export const ADMIN_DEFAULT_LAYOUT: WidgetPosition[] = [
  // Row 1: Triage and navigation
  { i: 'action-required', x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'my-rooms', x: 6, y: 0, w: 6, h: 4, minW: 4, minH: 3 },

  // Row 2: Operational context
  { i: 'recent-activity', x: 0, y: 4, w: 7, h: 4, minW: 5, minH: 3 },
  { i: 'messages', x: 7, y: 4, w: 5, h: 4, minW: 4, minH: 3 },

  // Row 3: New movement and trends
  { i: 'new-documents', x: 0, y: 8, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'engagement', x: 6, y: 8, w: 6, h: 3, minW: 4, minH: 2 },

  // Row 4: Supporting utility
  { i: 'checklist-progress', x: 0, y: 11, w: 4, h: 3, minW: 3, minH: 2 },
  { i: 'bookmarks', x: 4, y: 11, w: 4, h: 3, minW: 3, minH: 2 },
  { i: 'continue-reading', x: 8, y: 11, w: 4, h: 3, minW: 3, minH: 2 },
];

/**
 * Viewer default layout (8 widgets).
 * Optimized for document discovery and access.
 */
export const VIEWER_DEFAULT_LAYOUT: WidgetPosition[] = [
  // Row 1: Inbox and new movement
  { i: 'messages', x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'new-documents', x: 6, y: 0, w: 6, h: 4, minW: 4, minH: 3 },

  // Row 2: Navigation and questions
  { i: 'my-rooms', x: 0, y: 4, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'my-questions', x: 6, y: 4, w: 6, h: 4, minW: 4, minH: 3 },

  // Row 3: Personal utility
  { i: 'continue-reading', x: 0, y: 8, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'bookmarks', x: 6, y: 8, w: 6, h: 3, minW: 4, minH: 2 },

  // Row 4: Announcements (full width)
  { i: 'announcements', x: 0, y: 11, w: 12, h: 3, minW: 6, minH: 2 },
];

/**
 * Get the default layout for a given role.
 */
export function getDefaultLayout(role: 'ADMIN' | 'VIEWER'): WidgetPosition[] {
  return role === 'ADMIN' ? ADMIN_DEFAULT_LAYOUT : VIEWER_DEFAULT_LAYOUT;
}

/**
 * Get the list of widget IDs available for a role.
 */
export function getWidgetsForRole(role: 'ADMIN' | 'VIEWER'): WidgetId[] {
  if (role === 'ADMIN') {
    return [
      'action-required',
      'messages',
      'engagement',
      'my-rooms',
      'recent-activity',
      'checklist-progress',
      'continue-reading',
      'bookmarks',
      'new-documents',
    ];
  }

  return [
    'messages',
    'new-documents',
    'continue-reading',
    'bookmarks',
    'my-questions',
    'my-rooms',
    'announcements',
  ];
}

/**
 * Mobile stacked layout order by role.
 * On mobile (<768px), widgets are displayed in a fixed vertical stack.
 */
export const ADMIN_MOBILE_ORDER: WidgetId[] = [
  'action-required',
  'my-rooms',
  'recent-activity',
  'messages',
  'new-documents',
  'engagement',
  'checklist-progress',
  'bookmarks',
  'continue-reading',
];

export const VIEWER_MOBILE_ORDER: WidgetId[] = [
  'messages',
  'new-documents',
  'my-rooms',
  'my-questions',
  'continue-reading',
  'bookmarks',
  'announcements',
];

/**
 * Get mobile widget order for a role.
 */
export function getMobileOrder(role: 'ADMIN' | 'VIEWER'): WidgetId[] {
  return role === 'ADMIN' ? ADMIN_MOBILE_ORDER : VIEWER_MOBILE_ORDER;
}

/**
 * Widget display names.
 */
export const WIDGET_TITLES: Record<WidgetId, string> = {
  'action-required': 'Action Required',
  messages: 'Messages',
  engagement: 'Engagement Insights',
  'my-rooms': 'My Rooms',
  'recent-activity': 'Recent Activity',
  'checklist-progress': 'Checklist Progress',
  'continue-reading': 'Continue Reading',
  bookmarks: 'Bookmarks',
  'new-documents': 'New Documents',
  'my-questions': 'My Questions',
  announcements: 'Announcements',
};

/**
 * Default internal scroll heights for widgets (in pixels).
 */
export const WIDGET_SCROLL_HEIGHTS: Partial<Record<WidgetId, number>> = {
  'action-required': 300,
  messages: 250,
  'my-rooms': 300,
  'recent-activity': 350,
  bookmarks: 250,
  'new-documents': 250,
  'my-questions': 250,
};

/**
 * Grid configuration constants.
 */
const GRID_COLS = 12;

/**
 * Check if two layout items collide (overlap).
 */
function itemsCollide(a: WidgetPosition, b: WidgetPosition): boolean {
  if (a.i === b.i) {
    return false; // Same item
  }
  if (a.x + a.w <= b.x) {
    return false; // a is left of b
  }
  if (a.x >= b.x + b.w) {
    return false; // a is right of b
  }
  if (a.y + a.h <= b.y) {
    return false; // a is above b
  }
  if (a.y >= b.y + b.h) {
    return false; // a is below b
  }
  return true;
}

/**
 * Find first collision in layout for a given item.
 */
function getFirstCollision(
  layout: WidgetPosition[],
  item: WidgetPosition
): WidgetPosition | undefined {
  for (const other of layout) {
    if (itemsCollide(item, other)) {
      return other;
    }
  }
  return undefined;
}

/**
 * Compact a layout vertically.
 * Moves items up as far as possible without overlapping.
 * This is a simplified version of react-grid-layout's compact algorithm.
 */
export function compactLayout(layout: WidgetPosition[]): WidgetPosition[] {
  // Sort by y then x to process top-left items first
  const sorted = [...layout].sort((a, b) => {
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const compacted: WidgetPosition[] = [];

  for (const item of sorted) {
    // Create a copy of the item
    const compactedItem: WidgetPosition = { ...item };

    // Move item up as far as possible
    compactedItem.y = 0;

    // While there's a collision, move down
    let collision = getFirstCollision(compacted, compactedItem);
    while (collision) {
      // Move below the colliding item
      compactedItem.y = collision.y + collision.h;
      collision = getFirstCollision(compacted, compactedItem);
    }

    compacted.push(compactedItem);
  }

  // Sort back by original order (by id) for consistency
  return compacted.sort((a, b) => {
    const aIndex = layout.findIndex((l) => l.i === a.i);
    const bIndex = layout.findIndex((l) => l.i === b.i);
    return aIndex - bIndex;
  });
}

/**
 * Validate and sanitize a layout.
 * Ensures all positions are within grid bounds and have valid dimensions.
 */
export function sanitizeLayout(layout: WidgetPosition[]): WidgetPosition[] {
  return layout.map((item) => ({
    ...item,
    x: Math.max(0, Math.min(item.x, GRID_COLS - 1)),
    y: Math.max(0, item.y),
    w: Math.max(item.minW || 1, Math.min(item.w, GRID_COLS)),
    h: Math.max(item.minH || 1, item.h),
  }));
}

/**
 * Normalize a layout by sanitizing and compacting it.
 * Use this before saving to ensure consistent y-positions.
 */
export function normalizeLayout(layout: WidgetPosition[]): WidgetPosition[] {
  const sanitized = sanitizeLayout(layout);
  return compactLayout(sanitized);
}
