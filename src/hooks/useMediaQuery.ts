'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to detect if a media query matches.
 *
 * @param query - CSS media query string (e.g., "(min-width: 768px)")
 * @returns Whether the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/**
 * Breakpoint definitions matching Tailwind defaults and react-grid-layout.
 */
export const BREAKPOINTS = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1200,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Hook to get the current breakpoint.
 *
 * @returns Current breakpoint name
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width >= BREAKPOINTS['2xl']) {
        setBreakpoint('2xl');
      } else if (width >= BREAKPOINTS.xl) {
        setBreakpoint('xl');
      } else if (width >= BREAKPOINTS.lg) {
        setBreakpoint('lg');
      } else if (width >= BREAKPOINTS.md) {
        setBreakpoint('md');
      } else if (width >= BREAKPOINTS.sm) {
        setBreakpoint('sm');
      } else {
        setBreakpoint('xs');
      }
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  return breakpoint;
}

/**
 * Hook to detect mobile viewport (<768px).
 */
export function useIsMobile(): boolean {
  return !useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`);
}

/**
 * Hook to detect large viewport (>=1200px).
 * Edit mode is only enabled at this breakpoint.
 */
export function useIsLargeViewport(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
}

/**
 * Hook for responsive values based on breakpoint.
 */
export function useResponsiveValue<T>(values: Partial<Record<Breakpoint, T>>, fallback: T): T {
  const breakpoint = useBreakpoint();

  const getValue = useCallback(() => {
    // Check from largest to smallest
    const checkOrder: Breakpoint[] = ['lg', 'md', 'sm', 'xs'];
    const startIndex = checkOrder.indexOf(breakpoint);

    for (let i = startIndex; i < checkOrder.length; i++) {
      const bp = checkOrder[i];
      if (bp && values[bp] !== undefined) {
        return values[bp] as T;
      }
    }

    return fallback;
  }, [breakpoint, values, fallback]);

  return getValue();
}
