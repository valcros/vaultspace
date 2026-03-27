'use client';

/**
 * Enhanced Command Menu - Spotlight-style navigation
 *
 * This is a PROTOTYPE component for UI modernization proposal.
 * Uses existing Dialog component instead of cmdk.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { cn } from './utils';
import {
  Home,
  FolderOpen,
  Users,
  Activity,
  Settings,
  Plus,
  Upload,
  UserPlus,
  Search,
  Clock,
  Star,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';

interface CommandAction {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  href?: string;
  action?: () => void;
}

interface EnhancedCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recentRooms?: Array<{ id: string; name: string }>;
  favoriteRooms?: Array<{ id: string; name: string }>;
}

export function EnhancedCommandMenu({
  open,
  onOpenChange,
  recentRooms = [],
  favoriteRooms = [],
}: EnhancedCommandMenuProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const navigationItems: CommandAction[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, shortcut: '⌘D', href: '/rooms' },
    { id: 'rooms', label: 'All Rooms', icon: FolderOpen, shortcut: '⌘R', href: '/rooms' },
    { id: 'users', label: 'Users', icon: Users, shortcut: '⌘U', href: '/users' },
    { id: 'activity', label: 'Activity Log', icon: Activity, href: '/activity' },
    { id: 'settings', label: 'Settings', icon: Settings, shortcut: '⌘,', href: '/settings' },
  ];

  const actionItems: CommandAction[] = [
    { id: 'create-room', label: 'Create New Room', icon: Plus, shortcut: '⌘N' },
    { id: 'upload', label: 'Upload Documents', icon: Upload },
    { id: 'invite-user', label: 'Invite User', icon: UserPlus },
  ];

  // Filter items based on search
  const filteredNav = navigationItems.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredActions = actionItems.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRecent = recentRooms.filter((room) =>
    room.name.toLowerCase().includes(search.toLowerCase())
  );

  const allItems = [
    ...filteredRecent.map((r) => ({ ...r, type: 'recent' as const })),
    ...filteredNav.map((n) => ({ ...n, type: 'nav' as const })),
    ...filteredActions.map((a) => ({ ...a, type: 'action' as const })),
  ];

  const handleSelect = (item: CommandAction | { id: string; name: string; type: string }) => {
    if ('href' in item && item.href) {
      router.push(item.href);
    } else if ('name' in item) {
      router.push(`/rooms/${item.id}`);
    }
    onOpenChange(false);
    setSearch('');
  };

  // Handle keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

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
  }, [open, selectedIndex, allItems]);

  // Reset selection when search changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Focus input when dialog opens
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch('');
      setSelectedIndex(0);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center border-b px-4 py-3">
          <Search className="mr-3 h-5 w-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search rooms, documents, or type a command..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-gray-400"
          />
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto p-2">
          {allItems.length === 0 ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <Search className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">No results found</p>
              <p className="text-xs text-gray-400">Try a different search term</p>
            </div>
          ) : (
            <>
              {/* Recent Rooms */}
              {filteredRecent.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium text-gray-500 uppercase">Recent</p>
                  {filteredRecent.slice(0, 3).map((room, i) => (
                    <button
                      key={room.id}
                      onClick={() => handleSelect({ ...room, type: 'recent' })}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                        'transition-colors duration-100',
                        selectedIndex === i
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      )}
                    >
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span className="flex-1">{room.name}</span>
                      <ArrowRight className="h-4 w-4 text-gray-300" />
                    </button>
                  ))}
                </div>
              )}

              {/* Navigation */}
              {filteredNav.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium text-gray-500 uppercase">Navigation</p>
                  {filteredNav.map((item, i) => {
                    const idx = filteredRecent.length + i;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                          'transition-colors duration-100',
                          selectedIndex === idx
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                        )}
                      >
                        <item.icon className="h-4 w-4 text-gray-400" />
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-gray-400">{item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Quick Actions */}
              {filteredActions.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-medium text-gray-500 uppercase">Quick Actions</p>
                  {filteredActions.map((item, i) => {
                    const idx = filteredRecent.length + filteredNav.length + i;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                          'transition-colors duration-100',
                          selectedIndex === idx
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                        )}
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900">
                          <item.icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
                        </div>
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-gray-400">{item.shortcut}</span>
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
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-gray-400">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">↵</kbd> Select
            </span>
            <span>
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">esc</kbd> Close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to handle ⌘K keyboard shortcut
 */
export function useCommandMenu() {
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

export default EnhancedCommandMenu;
