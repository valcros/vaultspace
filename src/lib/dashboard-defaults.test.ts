/**
 * Dashboard Defaults Tests
 *
 * Tests for default layout integrity and the normalizeLayout save path.
 * The render path no longer calls compactLayout — react-grid-layout handles
 * compaction via compactType="vertical". These tests validate:
 *   1. Default layouts are collision-free and grid-compliant
 *   2. normalizeLayout (used on save) still produces valid layouts
 *   3. Filtering preserves original positions (no re-compaction)
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeLayout,
  getDefaultLayout,
  ADMIN_DEFAULT_LAYOUT,
  VIEWER_DEFAULT_LAYOUT,
} from './dashboard-defaults';
import type { WidgetPosition } from '@/types/dashboard';

// Helper: check no two items overlap
function assertNoOverlaps(layout: WidgetPosition[], label: string) {
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i]!;
      const b = layout[j]!;
      const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
      const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
      expect(xOverlap && yOverlap, `${label}: ${a.i} and ${b.i} overlap`).toBe(false);
    }
  }
}

describe('getDefaultLayout', () => {
  it('returns admin layout for ADMIN role', () => {
    expect(getDefaultLayout('ADMIN')).toBe(ADMIN_DEFAULT_LAYOUT);
  });

  it('returns viewer layout for VIEWER role', () => {
    expect(getDefaultLayout('VIEWER')).toBe(VIEWER_DEFAULT_LAYOUT);
  });

  it('admin default layout has no overlapping widgets', () => {
    assertNoOverlaps(ADMIN_DEFAULT_LAYOUT, 'ADMIN default');
  });

  it('viewer default layout has no overlapping widgets', () => {
    assertNoOverlaps(VIEWER_DEFAULT_LAYOUT, 'VIEWER default');
  });

  it('all widgets fit within 12-column grid', () => {
    for (const item of [...ADMIN_DEFAULT_LAYOUT, ...VIEWER_DEFAULT_LAYOUT]) {
      expect(item.x + item.w, `${item.i} exceeds grid width`).toBeLessThanOrEqual(12);
      expect(item.x, `${item.i} has negative x`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('normalizeLayout (save path)', () => {
  it('fixes corrupted y-positions before persisting', () => {
    const layout: WidgetPosition[] = [
      { i: 'a', x: 0, y: 50, w: 6, h: 3 },
      { i: 'b', x: 6, y: 100, w: 6, h: 3 },
    ];
    const result = normalizeLayout(layout);
    expect(result.find((i) => i.i === 'a')!.y).toBe(0);
    expect(result.find((i) => i.i === 'b')!.y).toBe(0);
  });

  it('clamps out-of-bounds positions', () => {
    const layout: WidgetPosition[] = [{ i: 'a', x: -5, y: -3, w: 1, h: 1, minW: 4, minH: 2 }];
    const result = normalizeLayout(layout);
    expect(result[0]!.x).toBe(0);
    expect(result[0]!.y).toBe(0);
    expect(result[0]!.w).toBe(4);
    expect(result[0]!.h).toBe(2);
  });
});

describe('render-path filtering (no compaction)', () => {
  // The dashboard page now does: layout.filter(hasData) — no compactLayout call.
  // This means y-positions are preserved as-is and react-grid-layout's
  // compactType="vertical" handles gap removal at render time.

  it('filter-only preserves original y-positions', () => {
    const layout = [...ADMIN_DEFAULT_LAYOUT];
    const widgetsWithData = ['action-required', 'messages', 'my-rooms', 'recent-activity'];
    const filtered = layout.filter((item) => widgetsWithData.includes(item.i));

    // Positions should be identical to the originals — no re-compaction
    for (const item of filtered) {
      const original = ADMIN_DEFAULT_LAYOUT.find((o) => o.i === item.i)!;
      expect(item.x).toBe(original.x);
      expect(item.y).toBe(original.y);
      expect(item.w).toBe(original.w);
      expect(item.h).toBe(original.h);
    }
  });

  it('filter-only removes all items without data', () => {
    const layout = [...VIEWER_DEFAULT_LAYOUT];
    const widgetsWithData = ['messages', 'new-documents'];
    const filtered = layout.filter((item) => widgetsWithData.includes(item.i));

    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.i).sort()).toEqual(['messages', 'new-documents']);
  });

  it('filtered admin layout has no overlaps even without compaction', () => {
    // The original default layout is collision-free, so any subset is also collision-free
    const widgetsWithData = ['action-required', 'engagement', 'continue-reading', 'bookmarks'];
    const filtered = ADMIN_DEFAULT_LAYOUT.filter((item) => widgetsWithData.includes(item.i));
    assertNoOverlaps(filtered, 'filtered ADMIN');
  });

  it('filtered viewer layout has no overlaps even without compaction', () => {
    const widgetsWithData = ['messages', 'my-questions', 'announcements'];
    const filtered = VIEWER_DEFAULT_LAYOUT.filter((item) => widgetsWithData.includes(item.i));
    assertNoOverlaps(filtered, 'filtered VIEWER');
  });

  it('filtered layout may have visual gaps that RGL compactType handles', () => {
    // Remove row 0 widgets, leaving row 1+ with original y-positions
    const widgetsWithData = ['messages', 'new-documents', 'engagement'];
    const filtered = ADMIN_DEFAULT_LAYOUT.filter((item) => widgetsWithData.includes(item.i));

    // All remaining widgets have y > 0 — there are gaps
    // This is expected: react-grid-layout's compactType="vertical" fills them at render
    const hasGaps = filtered.every((item) => item.y > 0);
    expect(hasGaps).toBe(true);
  });
});
