'use client';

/**
 * DockShell - Modern floating dock navigation layout
 *
 * Replaces traditional sidebar with:
 * - Floating dock (macOS-style)
 * - Command palette (⌘K)
 * - Touch-friendly mode for tablets
 */

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { DockHeader } from './dock-header';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  UsersRound,
  Activity,
  Mail,
  Settings,
  Search,
  Plus,
  GripVertical,
  X,
  ChevronUp,
  Clock,
  ArrowRight,
  Upload,
  UserPlus,
  FileText,
  Loader2,
  type LucideIcon,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface DockShellProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    imageUrl?: string | null;
  };
}

interface DockItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: number;
}

type DockPosition = 'top' | 'bottom' | 'left' | 'right';

// ============================================================================
// Navigation Configuration
// ============================================================================

const navigationItems: DockItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { id: 'rooms', label: 'Rooms', icon: FolderOpen, href: '/rooms' },
  { id: 'users', label: 'Users', icon: Users, href: '/users' },
  { id: 'groups', label: 'Groups', icon: UsersRound, href: '/groups' },
  { id: 'activity', label: 'Activity', icon: Activity, href: '/activity' },
  { id: 'messages', label: 'Messages', icon: Mail, href: '/messages' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

const quickActions: DockItem[] = [
  { id: 'search', label: 'Search', icon: Search, href: '#search' },
  { id: 'create', label: 'Create Room', icon: Plus, href: '#create' },
];

// ============================================================================
// Hooks
// ============================================================================

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

    const handleTouch = () => {
      setIsTouch(true);
      window.removeEventListener('touchstart', handleTouch);
    };
    window.addEventListener('touchstart', handleTouch, { passive: true });
    return () => window.removeEventListener('touchstart', handleTouch);
  }, []);

  return isTouch;
}

function useScrollDirection(enabled: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  const [isVisible, setIsVisible] = React.useState(true);
  const lastScrollY = React.useRef(0);

  React.useEffect(() => {
    if (!enabled) {
      setIsVisible(true);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const currentScrollY = container.scrollTop;
      const scrollingDown = currentScrollY > lastScrollY.current;
      const scrollingUp = currentScrollY < lastScrollY.current;
      const atTop = currentScrollY < 50;

      if (atTop) {
        setIsVisible(true);
      } else if (scrollingDown && currentScrollY > 100) {
        setIsVisible(false);
      } else if (scrollingUp) {
        setIsVisible(true);
      }

      lastScrollY.current = currentScrollY;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [enabled, containerRef]);

  return { isVisible, forceShow: () => setIsVisible(true) };
}

function useDragToPosition(
  initialPosition: DockPosition,
  enabled: boolean,
  _dockRef: React.RefObject<HTMLDivElement | null>
) {
  const [position, setPosition] = React.useState<DockPosition>(initialPosition);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDragStart = React.useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!enabled) {
        return;
      }
      e.preventDefault();
      setIsDragging(true);
    },
    [enabled]
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

    const handleEnd = () => setIsDragging(false);

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
  }, [isDragging, enabled]);

  return { position, isDragging, handleDragStart };
}

function useCommandMenu() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { open, setOpen };
}

// ============================================================================
// Main Component
// ============================================================================

export function DockShell({ children, user }: DockShellProps) {
  const mainRef = React.useRef<HTMLElement>(null);
  const dockRef = React.useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const isTouch = useIsTouchDevice();
  const { isVisible, forceShow } = useScrollDirection(true, mainRef);
  const { position, isDragging, handleDragStart } = useDragToPosition('bottom', true, dockRef);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandMenu();
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const isHorizontal = position === 'top' || position === 'bottom';

  const positionClasses: Record<DockPosition, string> = {
    top: 'top-4 left-1/2 -translate-x-1/2 flex-row',
    bottom: 'bottom-4 left-1/2 -translate-x-1/2 flex-row',
    left: 'left-4 top-1/2 -translate-y-1/2 flex-col',
    right: 'right-4 top-1/2 -translate-y-1/2 flex-col',
  };

  const hideTransform: Record<DockPosition, string> = {
    top: '-translate-y-full -translate-x-1/2 opacity-0',
    bottom: 'translate-y-full -translate-x-1/2 opacity-0',
    left: '-translate-x-full -translate-y-1/2 opacity-0',
    right: 'translate-x-full -translate-y-1/2 opacity-0',
  };

  const handleDockItemClick = (item: DockItem) => {
    if (item.id === 'search') {
      setCommandOpen(true);
    }
    // Create room action could open a modal
  };

  // Calculate padding based on dock position
  const contentPadding = {
    top: 'pt-20',
    bottom: 'pb-20',
    left: 'pl-20',
    right: 'pr-20',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <DockHeader user={user} onSearchClick={() => setCommandOpen(true)} />
        <main
          ref={mainRef}
          className={clsx('flex-1 overflow-y-auto p-4 lg:p-6', contentPadding[position])}
        >
          {children}
        </main>
      </div>

      {/* Floating Dock */}
      <div
        ref={dockRef}
        className={clsx(
          'fixed z-50 flex items-center gap-1 p-2',
          'bg-white/95 dark:bg-neutral-900/95',
          'backdrop-blur-xl',
          'border border-neutral-200 dark:border-neutral-700',
          'rounded-2xl shadow-2xl',
          'transition-all duration-300 ease-out',
          isVisible && !isCollapsed ? positionClasses[position] : hideTransform[position],
          isDragging && 'shadow-3xl scale-105 cursor-grabbing'
        )}
      >
        {/* Drag Handle */}
        <div
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          className={clsx(
            'flex cursor-grab items-center justify-center active:cursor-grabbing',
            'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
            'transition-colors',
            isHorizontal ? 'px-1' : 'py-1'
          )}
          title="Drag to reposition"
        >
          <GripVertical className={clsx('h-4 w-4', !isHorizontal && 'rotate-90')} />
        </div>

        {/* Navigation Items */}
        {navigationItems.map((item) => (
          <DockIcon
            key={item.id}
            item={item}
            isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            onClick={() => handleDockItemClick(item)}
            isTouch={isTouch}
            isHorizontal={isHorizontal}
          />
        ))}

        {/* Separator */}
        <div
          className={clsx(
            'bg-neutral-300 dark:bg-neutral-600',
            isHorizontal ? 'mx-1 h-8 w-px' : 'my-1 h-px w-8'
          )}
        />

        {/* Quick Actions */}
        {quickActions.map((item) => (
          <DockIcon
            key={item.id}
            item={item}
            isActive={false}
            onClick={() => handleDockItemClick(item)}
            isTouch={isTouch}
            isHorizontal={isHorizontal}
          />
        ))}

        {/* Collapse Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={clsx(
            'flex items-center justify-center',
            'h-8 w-8 rounded-lg',
            'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800',
            'transition-all duration-200'
          )}
          title="Hide dock"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Show Dock Button (when hidden) */}
      {(!isVisible || isCollapsed) && (
        <button
          onClick={() => {
            forceShow();
            setIsCollapsed(false);
          }}
          className={clsx(
            'fixed z-50 flex items-center justify-center',
            'h-10 w-10 rounded-full',
            'bg-white/95 dark:bg-neutral-900/95',
            'backdrop-blur-xl',
            'border border-neutral-200 dark:border-neutral-700',
            'shadow-lg hover:shadow-xl',
            'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            'transition-all duration-200',
            position === 'bottom' && 'bottom-4 left-1/2 -translate-x-1/2',
            position === 'top' && 'left-1/2 top-4 -translate-x-1/2',
            position === 'left' && 'left-4 top-1/2 -translate-y-1/2',
            position === 'right' && 'right-4 top-1/2 -translate-y-1/2'
          )}
          title="Show navigation dock"
        >
          <ChevronUp
            className={clsx(
              'h-5 w-5',
              position === 'top' && 'rotate-180',
              position === 'left' && '-rotate-90',
              position === 'right' && 'rotate-90'
            )}
          />
        </button>
      )}

      {/* Search FAB for touch devices */}
      {isTouch && (
        <button
          onClick={() => setCommandOpen(true)}
          className={clsx(
            'fixed z-50 flex items-center gap-2',
            'rounded-full px-4 py-3',
            'bg-primary-600 hover:bg-primary-700 active:bg-primary-800',
            'font-medium text-white',
            'shadow-lg hover:shadow-xl',
            'transition-all duration-200',
            position === 'bottom' ? 'right-4 top-4' : 'bottom-4 right-4'
          )}
          aria-label="Open search"
        >
          <Search className="h-5 w-5" />
          <span className="text-sm">Search</span>
        </button>
      )}

      {/* Command Menu */}
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        recentRooms={[
          { id: '1', name: 'Due Diligence Package' },
          { id: '2', name: 'Board Materials Q4' },
          { id: '3', name: 'Series A Funding' },
        ]}
      />
    </div>
  );
}

// ============================================================================
// Dock Icon Component
// ============================================================================

interface DockIconProps {
  item: DockItem;
  isActive: boolean;
  onClick?: () => void;
  isTouch: boolean;
  isHorizontal: boolean;
}

function DockIcon({ item, isActive, onClick, isTouch, isHorizontal }: DockIconProps) {
  const Icon = item.icon;
  const href = item.href.startsWith('#') ? undefined : item.href;

  const content = (
    <>
      <Icon
        className={clsx(
          isActive ? 'text-primary-600' : 'text-neutral-700 dark:text-neutral-300',
          isTouch ? 'h-6 w-6' : 'h-5 w-5'
        )}
      />

      {/* Inline label for touch mode (vertical dock) */}
      {isTouch && !isHorizontal && (
        <span
          className={clsx(
            'text-sm font-medium',
            isActive ? 'text-primary-600' : 'text-neutral-700 dark:text-neutral-300'
          )}
        >
          {item.label}
        </span>
      )}

      {/* Badge */}
      {item.badge && (
        <span
          className={clsx(
            'absolute flex items-center justify-center',
            'rounded-full bg-danger-500 text-xs font-bold text-white',
            isTouch ? '-right-1 -top-1 h-6 w-6' : '-right-1 -top-1 h-5 w-5'
          )}
        >
          {item.badge}
        </span>
      )}

      {/* Tooltip */}
      {(!isTouch || isHorizontal) && (
        <span
          className={clsx(
            'absolute whitespace-nowrap rounded-lg bg-neutral-900 px-2 py-1',
            'text-xs text-white',
            'opacity-0 group-hover:opacity-100',
            'transition-opacity duration-200',
            'pointer-events-none',
            'dark:bg-neutral-100 dark:text-neutral-900',
            isHorizontal ? '-top-10 left-1/2 -translate-x-1/2' : 'left-full ml-2'
          )}
        >
          {item.label}
          {item.id === 'search' && !isTouch && (
            <kbd className="ml-1 rounded bg-neutral-700 px-1 text-[10px] dark:bg-neutral-300">
              ⌘K
            </kbd>
          )}
        </span>
      )}
    </>
  );

  const className = clsx(
    'relative flex items-center justify-center rounded-xl',
    isActive
      ? 'bg-primary-50 dark:bg-primary-900/30'
      : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700',
    'transition-all duration-200 ease-out',
    'group',
    isTouch ? 'h-14 w-14 active:scale-95' : 'h-12 w-12 hover:scale-110 hover:shadow-lg',
    isTouch && !isHorizontal && 'w-auto gap-2 px-3'
  );

  if (href) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {content}
      </a>
    );
  }

  return (
    <button className={className} onClick={onClick}>
      {content}
    </button>
  );
}

// ============================================================================
// Command Menu Component
// ============================================================================

interface DocumentSearchResult {
  documentId: string;
  title: string;
  fileName: string;
  snippet: string;
  score: number;
  mimeType: string;
  roomId: string;
  roomName: string;
}

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recentRooms?: Array<{ id: string; name: string }>;
}

function CommandMenu({ open, onOpenChange, recentRooms = [] }: CommandMenuProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [docResults, setDocResults] = React.useState<DocumentSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchTotal, setSearchTotal] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const navigationItems = [
    { id: 'rooms', label: 'All Rooms', icon: FolderOpen, shortcut: '⌘R', href: '/rooms' },
    { id: 'users', label: 'Users', icon: Users, shortcut: '⌘U', href: '/users' },
    { id: 'groups', label: 'Groups', icon: UsersRound, href: '/groups' },
    { id: 'activity', label: 'Activity Log', icon: Activity, href: '/activity' },
    { id: 'settings', label: 'Settings', icon: Settings, shortcut: '⌘,', href: '/settings' },
  ];

  const actionItems = [
    { id: 'create-room', label: 'Create New Room', icon: Plus, shortcut: '⌘N' },
    { id: 'upload', label: 'Upload Documents', icon: Upload },
    { id: 'invite-user', label: 'Invite User', icon: UserPlus },
  ];

  const filteredNav = navigationItems.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredActions = actionItems.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRecent = recentRooms.filter((room) =>
    room.name.toLowerCase().includes(search.toLowerCase())
  );

  // Debounced document search
  React.useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setDocResults([]);
      setSearchTotal(0);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timer = setTimeout(async () => {
      // Cancel previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(search.trim())}&limit=5`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setDocResults([]);
          setSearchTotal(0);
          setIsSearching(false);
          return;
        }
        const data = await res.json();
        if (!controller.signal.aborted) {
          setDocResults(data.results || []);
          setSearchTotal(data.total || 0);
          setIsSearching(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setDocResults([]);
          setSearchTotal(0);
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const allItems = [
    ...docResults.map((d) => ({ ...d, id: d.documentId, type: 'document' as const })),
    ...filteredRecent.map((r) => ({ ...r, type: 'recent' as const })),
    ...filteredNav.map((n) => ({ ...n, type: 'nav' as const })),
    ...filteredActions.map((a) => ({ ...a, type: 'action' as const })),
  ];

  const handleSelect = (item: (typeof allItems)[number]) => {
    if (item.type === 'document') {
      const doc = item as DocumentSearchResult & { type: 'document' };
      router.push(`/rooms/${doc.roomId}?doc=${doc.documentId}`);
    } else if ('href' in item && item.href) {
      router.push(item.href);
    } else if ('name' in item) {
      router.push(`/rooms/${item.id}`);
    }
    onOpenChange(false);
    setSearch('');
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && allItems[selectedIndex]) {
        e.preventDefault();
        handleSelect(allItems[selectedIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedIndex, allItems.length]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch('');
      setSelectedIndex(0);
      setDocResults([]);
      setSearchTotal(0);
    }
  }, [open]);

  const showEmptyState = !isSearching && search.trim().length >= 2 && allItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {/* Search Input */}
        <div className="flex items-center border-b px-4 py-3">
          {isSearching ? (
            <Loader2 className="mr-3 h-5 w-5 animate-spin text-neutral-400" />
          ) : (
            <Search className="mr-3 h-5 w-5 text-neutral-400" />
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search rooms, documents, or type a command..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400"
          />
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto p-2">
          {showEmptyState ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                <Search className="h-6 w-6 text-neutral-400" />
              </div>
              <p className="text-sm text-neutral-500">No results found</p>
              <p className="text-xs text-neutral-400">Try a different search term</p>
            </div>
          ) : (
            <>
              {/* Document Results */}
              {docResults.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium uppercase text-neutral-500">
                    Documents{searchTotal > docResults.length ? ` (${searchTotal} total)` : ''}
                  </p>
                  {docResults.map((doc, i) => (
                    <button
                      key={doc.documentId}
                      onClick={() => handleSelect({ ...doc, id: doc.documentId, type: 'document' })}
                      className={clsx(
                        'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left',
                        'transition-colors duration-100',
                        selectedIndex === i
                          ? 'bg-primary-50 dark:bg-primary-900/20'
                          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      )}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        {doc.snippet && (
                          <p
                            className="mt-0.5 line-clamp-2 text-xs text-neutral-500"
                            dangerouslySetInnerHTML={{ __html: doc.snippet }}
                          />
                        )}
                        <p className="mt-0.5 text-xs text-neutral-400">{doc.roomName}</p>
                      </div>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300" />
                    </button>
                  ))}
                </div>
              )}

              {/* Recent Rooms */}
              {filteredRecent.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium uppercase text-neutral-500">Recent</p>
                  {filteredRecent.slice(0, 3).map((room, i) => {
                    const idx = docResults.length + i;
                    return (
                      <button
                        key={room.id}
                        onClick={() => handleSelect({ ...room, type: 'recent' })}
                        className={clsx(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                          'transition-colors duration-100',
                          selectedIndex === idx
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                      >
                        <Clock className="h-4 w-4 text-neutral-400" />
                        <span className="flex-1">{room.name}</span>
                        <ArrowRight className="h-4 w-4 text-neutral-300" />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Navigation */}
              {filteredNav.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium uppercase text-neutral-500">
                    Navigation
                  </p>
                  {filteredNav.map((item, i) => {
                    const idx = docResults.length + filteredRecent.length + i;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect({ ...item, type: 'nav' })}
                        className={clsx(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                          'transition-colors duration-100',
                          selectedIndex === idx
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                      >
                        <item.icon className="h-4 w-4 text-neutral-400" />
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-neutral-400">{item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Quick Actions */}
              {filteredActions.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium uppercase text-neutral-500">
                    Quick Actions
                  </p>
                  {filteredActions.map((item, i) => {
                    const idx = docResults.length + filteredRecent.length + filteredNav.length + i;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect({ ...item, type: 'action' })}
                        className={clsx(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                          'transition-colors duration-100',
                          selectedIndex === idx
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-100 dark:bg-primary-900">
                          <item.icon className="h-3.5 w-3.5 text-primary-600 dark:text-primary-300" />
                        </div>
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-neutral-400">{item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-neutral-400">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">↑↓</kbd>{' '}
              Navigate
            </span>
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">↵</kbd>{' '}
              Select
            </span>
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">esc</kbd>{' '}
              Close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DockShell;
