/**
 * Dashboard Defaults Tests
 *
 * Regression tests for layout compaction, sanitization, and default layouts.
 * These verify the fixes for overlapping widgets and spacing gaps.
 */

import { describe, it, expect } from 'vitest';
import {
  compactLayout,
  sanitizeLayout,
  normalizeLayout,
  getDefaultLayout,
  ADMIN_DEFAULT_LAYOUT,
  VIEWER_DEFAULT_LAYOUT,
} from './dashboard-defaults';
import type { WidgetPosition } from '@/types/dashboard';

describe('compactLayout', () => {
  it('moves items up to fill gaps left by removed widgets', () => {
    // Simulate: row 0 widget removed, row 1 widget should move up
    const layout: WidgetPosition[] = [
      { i: 'b', x: 0, y: 3, w: 6, h: 3 },
      { i: 'c', x: 0, y: 6, w: 6, h: 3 },
    ];
    const result = compactLayout(layout);
    expect(result.find((i) => i.i === 'b')!.y).toBe(0);
    expect(result.find((i) => i.i === 'c')!.y).toBe(3);
  });

  it('does not overlap side-by-side widgets on the same row', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: 0, y: 0, w: 6, h: 3 },
      { i: 'b', x: 6, y: 0, w: 6, h: 3 },
    ];
    const result = compactLayout(layout);
    // Both should stay at y=0 since they don't collide horizontally
    expect(result.find((i) => i.i === 'a')!.y).toBe(0);
    expect(result.find((i) => i.i === 'b')!.y).toBe(0);
  });

  it('stacks vertically overlapping widgets without collision', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: 0, y: 0, w: 12, h: 3 },
      { i: 'b', x: 0, y: 0, w: 12, h: 3 }, // same position, should be pushed down
    ];
    const result = compactLayout(layout);
    const a = result.find((i) => i.i === 'a')!;
    const b = result.find((i) => i.i === 'b')!;
    // One should be at 0, the other at 3 (no overlap)
    expect(a.y + a.h).toBeLessThanOrEqual(b.y);
  });

  it('compacts a sparse layout with large gaps', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: 0, y: 0, w: 6, h: 3 },
      { i: 'b', x: 0, y: 100, w: 6, h: 3 }, // huge gap
    ];
    const result = compactLayout(layout);
    expect(result.find((i) => i.i === 'b')!.y).toBe(3); // compacted right below a
  });

  it('returns empty array for empty input', () => {
    expect(compactLayout([])).toEqual([]);
  });

  it('handles single-item layout', () => {
    const layout: WidgetPosition[] = [{ i: 'a', x: 0, y: 5, w: 6, h: 3 }];
    const result = compactLayout(layout);
    expect(result[0]!.y).toBe(0);
  });

  it('compacts admin default layout after filtering out some widgets', () => {
    // Simulate filtering: remove engagement and checklist-progress
    const filtered = ADMIN_DEFAULT_LAYOUT.filter(
      (w) => w.i !== 'engagement' && w.i !== 'checklist-progress'
    );
    const result = compactLayout(filtered);

    // Verify no overlaps exist in the compacted result
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]!;
        const b = result[j]!;
        const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
        const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
        expect(
          xOverlap && yOverlap,
          `Widgets ${a.i} and ${b.i} overlap`
        ).toBe(false);
      }
    }
  });

  it('compacts viewer default layout after filtering out some widgets', () => {
    // Simulate filtering: remove bookmarks and my-questions
    const filtered = VIEWER_DEFAULT_LAYOUT.filter(
      (w) => w.i !== 'bookmarks' && w.i !== 'my-questions'
    );
    const result = compactLayout(filtered);

    // No gaps: every widget should either be at y=0 or directly below another
    for (const item of result) {
      if (item.y === 0) {
        continue;
      }
      // There must be at least one widget above that ends at or below this y
      const hasSupport = result.some(
        (other) =>
          other.i !== item.i &&
          other.x < item.x + item.w &&
          other.x + other.w > item.x &&
          other.y + other.h === item.y
      );
      expect(hasSupport, `Widget ${item.i} at y=${item.y} has a gap above it`).toBe(true);
    }
  });
});

describe('sanitizeLayout', () => {
  it('clamps negative x/y to 0', () => {
    const layout: WidgetPosition[] = [{ i: 'a', x: -5, y: -3, w: 6, h: 3 }];
    const result = sanitizeLayout(layout);
    expect(result[0]!.x).toBe(0);
    expect(result[0]!.y).toBe(0);
  });

  it('clamps x to grid bounds', () => {
    const layout: WidgetPosition[] = [{ i: 'a', x: 20, y: 0, w: 6, h: 3 }];
    const result = sanitizeLayout(layout);
    expect(result[0]!.x).toBeLessThanOrEqual(11);
  });

  it('enforces minW and minH', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: 0, y: 0, w: 1, h: 1, minW: 4, minH: 3 },
    ];
    const result = sanitizeLayout(layout);
    expect(result[0]!.w).toBe(4);
    expect(result[0]!.h).toBe(3);
  });
});

describe('normalizeLayout', () => {
  it('sanitizes and compacts in one pass', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: -1, y: 50, w: 6, h: 3 },
      { i: 'b', x: 6, y: 100, w: 6, h: 3 },
    ];
    const result = normalizeLayout(layout);
    // Both should be compacted to top
    expect(result.find((i) => i.i === 'a')!.y).toBe(0);
    expect(result.find((i) => i.i === 'a')!.x).toBe(0);
    expect(result.find((i) => i.i === 'b')!.y).toBe(0);
  });
});

describe('getDefaultLayout', () => {
  it('returns admin layout for ADMIN role', () => {
    expect(getDefaultLayout('ADMIN')).toBe(ADMIN_DEFAULT_LAYOUT);
  });

  it('returns viewer layout for VIEWER role', () => {
    expect(getDefaultLayout('VIEWER')).toBe(VIEWER_DEFAULT_LAYOUT);
  });

  it('admin default layout has no overlapping widgets', () => {
    const layout = ADMIN_DEFAULT_LAYOUT;
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i]!;
        const b = layout[j]!;
        const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
        const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
        expect(
          xOverlap && yOverlap,
          `Default admin widgets ${a.i} and ${b.i} overlap`
        ).toBe(false);
      }
    }
  });

  it('viewer default layout has no overlapping widgets', () => {
    const layout = VIEWER_DEFAULT_LAYOUT;
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i]!;
        const b = layout[j]!;
        const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
        const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
        expect(
          xOverlap && yOverlap,
          `Default viewer widgets ${a.i} and ${b.i} overlap`
        ).toBe(false);
      }
    }
  });

  it('all widgets fit within 12-column grid', () => {
    for (const item of [...ADMIN_DEFAULT_LAYOUT, ...VIEWER_DEFAULT_LAYOUT]) {
      expect(item.x + item.w, `Widget ${item.i} exceeds grid width`).toBeLessThanOrEqual(12);
      expect(item.x, `Widget ${item.i} has negative x`).toBeGreaterThanOrEqual(0);
    }
  });
});
