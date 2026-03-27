'use client';

/**
 * Enhanced Floating Dock Component - macOS-style navigation
 *
 * Features:
 * - Auto-hide on scroll (shows on scroll up, hides on scroll down)
 * - Drag-to-position (drag to any screen edge)
 * - Touch-friendly mode (detects touch devices, shows labels)
 * - Visible search FAB for tablet/touch users
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from './utils';
import {
  Home,
  FolderOpen,
  Users,
  Activity,
  Settings,
  Search,
  Plus,
  HelpCircle,
  GripVertical,
  X,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface DockItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: number;
}

type DockPosition = 'top' | 'bottom' | 'left' | 'right';

interface FloatingDockProps {
  items?: DockItem[];
  actions?: DockItem[];
  initialPosition?: DockPosition;
  className?: string;
  onItemClick?: (item: DockItem) => void;
  onSearchClick?: () => void;
  enableAutoHide?: boolean;
  enableDrag?: boolean;
  enableTouchMode?: boolean;
  showSearchFAB?: boolean;
}

// ============================================================================
// Default Items
// ============================================================================

const defaultItems: DockItem[] = [
  { id: 'home', label: 'Dashboard', icon: Home, href: '/rooms' },
  { id: 'rooms', label: 'Rooms', icon: FolderOpen, href: '/rooms', badge: 3 },
  { id: 'users', label: 'Users', icon: Users, href: '/users' },
  { id: 'activity', label: 'Activity', icon: Activity, href: '/activity' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

const defaultActions: DockItem[] = [
  { id: 'search', label: 'Search', icon: Search, href: '#search' },
  { id: 'create', label: 'Create Room', icon: Plus, href: '#create' },
  { id: 'help', label: 'Help', icon: HelpCircle, href: '/help' },
];

// ============================================================================
// Hooks
// ============================================================================

/**
 * Detects if the device supports touch
 */
function useIsTouchDevice() {
  const [isTouch, setIsTouch] = React.useState(false);

  React.useEffect(() => {
    const checkTouch = () => {
      setIsTouch(
        'ontouchstart' in window ||
          navigator.maxTouchPoints > 0 ||
          // @ts-expect-error - msMaxTouchPoints is IE-specific
          navigator.msMaxTouchPoints > 0
      );
    };

    checkTouch();

    // Also listen for first touch event as fallback
    const handleTouch = () => {
      setIsTouch(true);
      window.removeEventListener('touchstart', handleTouch);
    };
    window.addEventListener('touchstart', handleTouch, { passive: true });

    return () => window.removeEventListener('touchstart', handleTouch);
  }, []);

  return isTouch;
}

/**
 * Tracks scroll direction for auto-hide functionality
 */
function useScrollDirection(enabled: boolean) {
  const [isVisible, setIsVisible] = React.useState(true);
  const [lastScrollY, setLastScrollY] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) {
      setIsVisible(true);
      return;
    }

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY;
      const scrollingUp = currentScrollY < lastScrollY;
      const atTop = currentScrollY < 50;

      if (atTop) {
        setIsVisible(true);
      } else if (scrollingDown && currentScrollY > 100) {
        setIsVisible(false);
      } else if (scrollingUp) {
        setIsVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [enabled, lastScrollY]);

  return { isVisible, forceShow: () => setIsVisible(true) };
}

/**
 * Handles drag-to-position functionality
 */
function useDragToPosition(
  initialPosition: DockPosition,
  enabled: boolean,
  dockRef: React.RefObject<HTMLDivElement | null>
) {
  const [position, setPosition] = React.useState<DockPosition>(initialPosition);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });

  const handleDragStart = React.useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!enabled) {
        return;
      }

      e.preventDefault();
      setIsDragging(true);

      const touch = 'touches' in e ? e.touches[0] : null;
      const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
      const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;

      if (dockRef.current) {
        const rect = dockRef.current.getBoundingClientRect();
        setDragOffset({
          x: clientX - rect.left - rect.width / 2,
          y: clientY - rect.top - rect.height / 2,
        });
      }
    },
    [enabled, dockRef]
  );

  React.useEffect(() => {
    if (!isDragging || !enabled) {
      return;
    }

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const touch = 'touches' in e ? e.touches[0] : null;
      const clientX = touch ? touch.clientX : (e as MouseEvent).clientX;
      const clientY = touch ? touch.clientY : (e as MouseEvent).clientY;

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calculate which edge is closest
      const distToTop = clientY;
      const distToBottom = windowHeight - clientY;
      const distToLeft = clientX;
      const distToRight = windowWidth - clientX;

      const minDist = Math.min(distToTop, distToBottom, distToLeft, distToRight);

      if (minDist === distToTop) {
        setPosition('top');
      } else if (minDist === distToBottom) {
        setPosition('bottom');
      } else if (minDist === distToLeft) {
        setPosition('left');
      } else {
        setPosition('right');
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, enabled, dragOffset]);

  return { position, isDragging, handleDragStart };
}

// ============================================================================
// Main Component
// ============================================================================

export function FloatingDock({
  items = defaultItems,
  actions = defaultActions,
  initialPosition = 'bottom',
  className,
  onItemClick,
  onSearchClick,
  enableAutoHide = true,
  enableDrag = true,
  enableTouchMode = true,
  showSearchFAB = true,
}: FloatingDockProps) {
  const dockRef = React.useRef<HTMLDivElement>(null);
  const isTouch = useIsTouchDevice();
  const shouldUseTouchMode = enableTouchMode && isTouch;
  const { isVisible, forceShow } = useScrollDirection(enableAutoHide);
  const { position, isDragging, handleDragStart } = useDragToPosition(
    initialPosition,
    enableDrag,
    dockRef
  );
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  // Position classes based on current dock position
  const positionClasses: Record<DockPosition, string> = {
    top: 'top-4 left-1/2 -translate-x-1/2 flex-row',
    bottom: 'bottom-4 left-1/2 -translate-x-1/2 flex-row',
    left: 'left-4 top-1/2 -translate-y-1/2 flex-col',
    right: 'right-4 top-1/2 -translate-y-1/2 flex-col',
  };

  // Hide transform based on position
  const hideTransform: Record<DockPosition, string> = {
    top: '-translate-y-full -translate-x-1/2 opacity-0',
    bottom: 'translate-y-full -translate-x-1/2 opacity-0',
    left: '-translate-x-full -translate-y-1/2 opacity-0',
    right: 'translate-x-full -translate-y-1/2 opacity-0',
  };

  const isHorizontal = position === 'top' || position === 'bottom';

  // Handle search click - either from dock item or FAB
  const handleSearchAction = React.useCallback(() => {
    onSearchClick?.();
    const searchItem = actions.find((a) => a.id === 'search');
    if (searchItem) {
      onItemClick?.(searchItem);
    }
  }, [onSearchClick, onItemClick, actions]);

  return (
    <>
      {/* Main Dock */}
      <div
        ref={dockRef}
        className={cn(
          'fixed z-50 flex items-center gap-1 p-2',
          'bg-white/90 dark:bg-gray-900/90',
          'backdrop-blur-xl',
          'border border-gray-200/50 dark:border-gray-700/50',
          'rounded-2xl shadow-2xl',
          'transition-all duration-300 ease-out',
          isVisible && !isCollapsed ? positionClasses[position] : hideTransform[position],
          isDragging && 'shadow-3xl scale-105 cursor-grabbing',
          className
        )}
      >
        {/* Drag Handle */}
        {enableDrag && (
          <div
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            className={cn(
              'flex cursor-grab items-center justify-center active:cursor-grabbing',
              'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
              'transition-colors',
              isHorizontal ? 'px-1' : 'py-1'
            )}
            title="Drag to reposition"
          >
            <GripVertical className={cn('h-4 w-4', !isHorizontal && 'rotate-90')} />
          </div>
        )}

        {/* Main Navigation Items */}
        {items.map((item) => (
          <DockIcon
            key={item.id}
            item={item}
            onClick={() => onItemClick?.(item)}
            isTouch={shouldUseTouchMode}
            isHorizontal={isHorizontal}
          />
        ))}

        {/* Separator */}
        <div
          className={cn(
            'bg-gray-300 dark:bg-gray-600',
            isHorizontal ? 'mx-1 h-8 w-px' : 'my-1 h-px w-8'
          )}
        />

        {/* Quick Actions */}
        {actions.map((item) => (
          <DockIcon
            key={item.id}
            item={item}
            onClick={() => {
              if (item.id === 'search') {
                handleSearchAction();
              } else {
                onItemClick?.(item);
              }
            }}
            isTouch={shouldUseTouchMode}
            isHorizontal={isHorizontal}
          />
        ))}

        {/* Collapse/Expand Button */}
        {enableAutoHide && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              'flex items-center justify-center',
              'h-8 w-8 rounded-lg',
              'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
              'hover:bg-gray-100 dark:hover:bg-gray-800',
              'transition-all duration-200'
            )}
            title={isCollapsed ? 'Show dock' : 'Hide dock'}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Show Dock Button (when collapsed or hidden) */}
      {enableAutoHide && (!isVisible || isCollapsed) && (
        <button
          onClick={() => {
            forceShow();
            setIsCollapsed(false);
          }}
          className={cn(
            'fixed z-50 flex items-center justify-center',
            'h-10 w-10 rounded-full',
            'bg-white/90 dark:bg-gray-900/90',
            'backdrop-blur-xl',
            'border border-gray-200/50 dark:border-gray-700/50',
            'shadow-lg hover:shadow-xl',
            'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
            'transition-all duration-200',
            'animate-in fade-in zoom-in',
            position === 'bottom' && 'bottom-4 left-1/2 -translate-x-1/2',
            position === 'top' && 'left-1/2 top-4 -translate-x-1/2',
            position === 'left' && 'left-4 top-1/2 -translate-y-1/2',
            position === 'right' && 'right-4 top-1/2 -translate-y-1/2'
          )}
          title="Show navigation dock"
        >
          <ChevronUp
            className={cn(
              'h-5 w-5',
              position === 'top' && 'rotate-180',
              position === 'left' && '-rotate-90',
              position === 'right' && 'rotate-90'
            )}
          />
        </button>
      )}

      {/* Search FAB for touch devices */}
      {showSearchFAB && shouldUseTouchMode && (
        <SearchFAB onClick={handleSearchAction} position={position} />
      )}
    </>
  );
}

// ============================================================================
// Dock Icon Component
// ============================================================================

interface DockIconProps {
  item: DockItem;
  onClick?: () => void;
  isTouch: boolean;
  isHorizontal: boolean;
}

function DockIcon({ item, onClick, isTouch, isHorizontal }: DockIconProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={(e) => {
        if (item.href.startsWith('#')) {
          e.preventDefault();
        }
        onClick?.();
      }}
      className={cn(
        'relative flex items-center justify-center rounded-xl',
        'bg-gray-100 dark:bg-gray-800',
        'hover:bg-gray-200 dark:hover:bg-gray-700',
        'transition-all duration-200 ease-out',
        'group',
        // Touch mode: larger targets, no magnification
        isTouch ? 'h-14 w-14 active:scale-95' : 'h-12 w-12 hover:scale-125 hover:shadow-lg',
        // Show labels in touch mode
        isTouch && !isHorizontal && 'w-auto gap-2 px-3'
      )}
    >
      <Icon className={cn('text-gray-700 dark:text-gray-300', isTouch ? 'h-6 w-6' : 'h-5 w-5')} />

      {/* Inline label for touch mode (vertical dock) */}
      {isTouch && !isHorizontal && (
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
      )}

      {/* Badge */}
      {item.badge && (
        <span
          className={cn(
            'absolute flex items-center justify-center',
            'rounded-full bg-red-500 text-xs font-bold text-white',
            isTouch ? '-right-1 -top-1 h-6 w-6' : '-right-1 -top-1 h-5 w-5'
          )}
        >
          {item.badge}
        </span>
      )}

      {/* Tooltip (only for non-touch or horizontal touch) */}
      {(!isTouch || isHorizontal) && (
        <span
          className={cn(
            'absolute whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1',
            'text-xs text-white',
            'opacity-0 group-hover:opacity-100',
            'transition-opacity duration-200',
            'pointer-events-none',
            'dark:bg-gray-100 dark:text-gray-900',
            isHorizontal ? '-top-10 left-1/2 -translate-x-1/2' : 'left-full ml-2'
          )}
        >
          {item.label}
          {item.id === 'search' && !isTouch && (
            <kbd className="ml-1 rounded bg-gray-700 px-1 text-[10px] dark:bg-gray-300">⌘K</kbd>
          )}
        </span>
      )}
    </Link>
  );
}

// ============================================================================
// Search FAB Component (for touch devices)
// ============================================================================

interface SearchFABProps {
  onClick: () => void;
  position: DockPosition;
}

function SearchFAB({ onClick, position }: SearchFABProps) {
  // Position FAB opposite to the dock to avoid overlap
  const fabPosition: Record<DockPosition, string> = {
    bottom: 'top-4 right-4',
    top: 'bottom-4 right-4',
    left: 'bottom-4 right-4',
    right: 'bottom-4 left-4',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed z-50 flex items-center gap-2',
        'rounded-full px-4 py-3',
        'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
        'font-medium text-white',
        'shadow-lg hover:shadow-xl',
        'transition-all duration-200',
        'animate-in fade-in zoom-in',
        fabPosition[position]
      )}
      aria-label="Open search"
    >
      <Search className="h-5 w-5" />
      <span className="text-sm">Search</span>
    </button>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default FloatingDock;
export type { DockItem, DockPosition, FloatingDockProps };
