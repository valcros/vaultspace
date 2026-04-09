/**
 * useMediaQuery / useBreakpoint Tests
 *
 * Regression tests for breakpoint detection logic.
 * Verifies that xl and 2xl breakpoints are correctly distinguished.
 */

import { describe, it, expect } from 'vitest';
import { BREAKPOINTS } from './useMediaQuery';

describe('BREAKPOINTS', () => {
  it('defines breakpoints in ascending order', () => {
    expect(BREAKPOINTS.xs).toBeLessThan(BREAKPOINTS.sm);
    expect(BREAKPOINTS.sm).toBeLessThan(BREAKPOINTS.md);
    expect(BREAKPOINTS.md).toBeLessThan(BREAKPOINTS.lg);
    expect(BREAKPOINTS.lg).toBeLessThan(BREAKPOINTS.xl);
    expect(BREAKPOINTS.xl).toBeLessThan(BREAKPOINTS['2xl']);
  });

  it('lg breakpoint is at 1200px for react-grid-layout alignment', () => {
    expect(BREAKPOINTS.lg).toBe(1200);
  });
});

describe('breakpoint resolution logic', () => {
  // Test the pure logic that useBreakpoint implements,
  // without needing a DOM/React rendering context.
  function resolveBreakpoint(width: number): keyof typeof BREAKPOINTS {
    if (width >= BREAKPOINTS['2xl']) {
      return '2xl';
    }
    if (width >= BREAKPOINTS.xl) {
      return 'xl';
    }
    if (width >= BREAKPOINTS.lg) {
      return 'lg';
    }
    if (width >= BREAKPOINTS.md) {
      return 'md';
    }
    if (width >= BREAKPOINTS.sm) {
      return 'sm';
    }
    return 'xs';
  }

  it('returns xs for small mobile widths', () => {
    expect(resolveBreakpoint(320)).toBe('xs');
    expect(resolveBreakpoint(0)).toBe('xs');
    expect(resolveBreakpoint(639)).toBe('xs');
  });

  it('returns sm at 640px', () => {
    expect(resolveBreakpoint(640)).toBe('sm');
    expect(resolveBreakpoint(767)).toBe('sm');
  });

  it('returns md at 768px', () => {
    expect(resolveBreakpoint(768)).toBe('md');
    expect(resolveBreakpoint(1199)).toBe('md');
  });

  it('returns lg at 1200px', () => {
    expect(resolveBreakpoint(1200)).toBe('lg');
    expect(resolveBreakpoint(1279)).toBe('lg');
  });

  it('returns xl at 1280px (not lg)', () => {
    expect(resolveBreakpoint(1280)).toBe('xl');
    expect(resolveBreakpoint(1535)).toBe('xl');
  });

  it('returns 2xl at 1536px (not lg)', () => {
    expect(resolveBreakpoint(1536)).toBe('2xl');
    expect(resolveBreakpoint(1920)).toBe('2xl');
    expect(resolveBreakpoint(3840)).toBe('2xl');
  });

  it('canEdit is true for lg, xl, and 2xl', () => {
    const canEdit = (bp: string) => bp === 'lg' || bp === 'xl' || bp === '2xl';
    expect(canEdit(resolveBreakpoint(1200))).toBe(true);
    expect(canEdit(resolveBreakpoint(1280))).toBe(true);
    expect(canEdit(resolveBreakpoint(1536))).toBe(true);
    expect(canEdit(resolveBreakpoint(1199))).toBe(false);
    expect(canEdit(resolveBreakpoint(768))).toBe(false);
  });
});
