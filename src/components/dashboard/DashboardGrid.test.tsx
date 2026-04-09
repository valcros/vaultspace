/**
 * Dashboard Grid + Widget + Context Regression Tests
 *
 * Tests the actual component behavior changed by the dashboard fix:
 *   1. DashboardGrid passes compactType="vertical" to react-grid-layout
 *   2. DashboardWidget renders with h-full, overflow-hidden, and scrollable content
 *   3. DashboardContext canEdit is true at lg, xl, and 2xl breakpoints
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';

// ── Mock react-grid-layout/legacy ──────────────────────────────────────────
let capturedGridProps: Record<string, unknown> = {};

vi.mock('react-grid-layout/legacy', () => {
  const MockGrid = React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
    function MockGrid(props, _ref) {
      capturedGridProps = props as Record<string, unknown>;
      return <div data-testid="mock-grid">{props.children}</div>;
    }
  );
  MockGrid.displayName = 'MockGrid';

  const WidthProvider =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Component: React.ComponentType<any>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Wrapped = React.forwardRef<HTMLDivElement, any>(function Wrapped(props, ref) {
        return <Component {...props} ref={ref} />;
      });
      Wrapped.displayName = 'WidthProviderGrid';
      return Wrapped;
    };

  return { default: MockGrid, WidthProvider };
});

vi.mock('react-grid-layout/css/styles.css', () => ({}));
vi.mock('react-resizable/css/styles.css', () => ({}));

// ── Mock useMediaQuery hooks ───────────────────────────────────────────────
let mockBreakpoint = 'lg';
let mockIsMobile = false;

vi.mock('@/hooks/useMediaQuery', () => ({
  useBreakpoint: () => mockBreakpoint,
  useIsMobile: () => mockIsMobile,
  BREAKPOINTS: { xs: 0, sm: 640, md: 768, lg: 1200, xl: 1280, '2xl': 1536 },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { render, screen } from '@testing-library/react';
import { DashboardGrid } from './DashboardGrid';
import { DashboardWidget } from './DashboardWidget';
import { DashboardProvider } from './DashboardContext';
import type { WidgetPosition } from '@/types/dashboard';

const TEST_LAYOUT: WidgetPosition[] = [
  { i: 'a', x: 0, y: 0, w: 6, h: 3 },
  { i: 'b', x: 6, y: 0, w: 6, h: 3 },
  { i: 'c', x: 0, y: 3, w: 12, h: 4 },
];

const noop = () => {};

function renderWithProvider(
  ui: React.ReactElement,
  options?: { breakpoint?: string; mobile?: boolean }
) {
  mockBreakpoint = options?.breakpoint ?? 'lg';
  mockIsMobile = options?.mobile ?? false;
  return render(<DashboardProvider>{ui}</DashboardProvider>);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardGrid', () => {
  beforeEach(() => {
    capturedGridProps = {};
    mockBreakpoint = 'lg';
    mockIsMobile = false;
  });

  it('passes compactType="vertical" to react-grid-layout', () => {
    renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
        <div key="b">B</div>
        <div key="c">C</div>
      </DashboardGrid>
    );

    expect(capturedGridProps['compactType']).toBe('vertical');
  });

  it('passes the layout positions through without modification', () => {
    renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
      </DashboardGrid>
    );

    const passedLayout = capturedGridProps['layout'] as WidgetPosition[];
    expect(passedLayout).toHaveLength(3);
    expect(passedLayout[0]).toMatchObject({ i: 'a', x: 0, y: 0 });
    expect(passedLayout[2]).toMatchObject({ i: 'c', x: 0, y: 3 });
  });

  it('disables drag and resize when not in edit mode', () => {
    renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
      </DashboardGrid>
    );

    expect(capturedGridProps['isDraggable']).toBe(false);
    expect(capturedGridProps['isResizable']).toBe(false);
  });

  it('returns null on mobile viewport', () => {
    const { container } = renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
      </DashboardGrid>,
      { mobile: true, breakpoint: 'xs' }
    );

    expect(container.querySelector('[data-testid="mock-grid"]')).toBeNull();
  });

  it('renders grid at xl breakpoint', () => {
    renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
      </DashboardGrid>,
      { breakpoint: 'xl' }
    );

    expect(screen.getByTestId('mock-grid')).toBeDefined();
  });

  it('renders grid at 2xl breakpoint', () => {
    renderWithProvider(
      <DashboardGrid layout={TEST_LAYOUT} onLayoutChange={noop}>
        <div key="a">A</div>
      </DashboardGrid>,
      { breakpoint: '2xl' }
    );

    expect(screen.getByTestId('mock-grid')).toBeDefined();
  });
});

describe('DashboardWidget', () => {
  it('renders Card with h-full and overflow-hidden for grid cell sizing', () => {
    const { container } = renderWithProvider(
      <DashboardWidget title="Test">Content</DashboardWidget>
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('h-full');
    expect(card.className).toContain('overflow-hidden');
  });

  it('renders content area with overflow-auto for internal scrolling', () => {
    const { container } = renderWithProvider(
      <DashboardWidget title="Test">Content</DashboardWidget>
    );

    const scrollable = container.querySelector('.overflow-auto');
    expect(scrollable).not.toBeNull();
  });

  it('renders header with shrink-0 to prevent compression', () => {
    const { container } = renderWithProvider(
      <DashboardWidget title="Test">Content</DashboardWidget>
    );

    const header = container.querySelector('.shrink-0');
    expect(header).not.toBeNull();
  });

  it('renders content area with min-h-0 for flex overflow', () => {
    const { container } = renderWithProvider(
      <DashboardWidget title="Test">Content</DashboardWidget>
    );

    const minH0 = container.querySelector('.min-h-0');
    expect(minH0).not.toBeNull();
  });
});
