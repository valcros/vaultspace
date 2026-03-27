'use client';

/**
 * Floating Dock Component - macOS-style navigation
 *
 * This is a PROTOTYPE component for UI modernization proposal.
 * Uses CSS transitions for animations (no framer-motion dependency).
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
  type LucideIcon,
} from 'lucide-react';

interface DockItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: number;
}

const defaultItems: DockItem[] = [
  { id: 'home', label: 'Dashboard', icon: Home, href: '/rooms' },
  { id: 'rooms', label: 'Rooms', icon: FolderOpen, href: '/rooms', badge: 3 },
  { id: 'users', label: 'Users', icon: Users, href: '/users' },
  { id: 'activity', label: 'Activity', icon: Activity, href: '/activity' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

const quickActions: DockItem[] = [
  { id: 'search', label: 'Search (⌘K)', icon: Search, href: '#search' },
  { id: 'create', label: 'Create Room', icon: Plus, href: '#create' },
  { id: 'help', label: 'Help', icon: HelpCircle, href: '/help' },
];

interface FloatingDockProps {
  items?: DockItem[];
  actions?: DockItem[];
  position?: 'bottom' | 'left' | 'right';
  className?: string;
  onItemClick?: (item: DockItem) => void;
}

export function FloatingDock({
  items = defaultItems,
  actions = quickActions,
  position = 'bottom',
  className,
  onItemClick,
}: FloatingDockProps) {
  const positionClasses = {
    bottom: 'bottom-6 left-1/2 -translate-x-1/2 flex-row',
    left: 'left-6 top-1/2 -translate-y-1/2 flex-col',
    right: 'right-6 top-1/2 -translate-y-1/2 flex-col',
  };

  return (
    <div
      className={cn(
        'fixed z-50 flex items-center gap-2 p-2',
        'bg-white/80 dark:bg-gray-900/80',
        'backdrop-blur-xl',
        'border border-gray-200/50 dark:border-gray-700/50',
        'rounded-2xl shadow-2xl',
        'animate-in fade-in slide-in-from-bottom-4 duration-300',
        positionClasses[position],
        className
      )}
    >
      {/* Main Navigation Items */}
      {items.map((item) => (
        <DockIcon
          key={item.id}
          item={item}
          onClick={() => onItemClick?.(item)}
        />
      ))}

      {/* Separator */}
      <div className="mx-1 h-8 w-px bg-gray-300 dark:bg-gray-600" />

      {/* Quick Actions */}
      {actions.map((item) => (
        <DockIcon
          key={item.id}
          item={item}
          onClick={() => onItemClick?.(item)}
        />
      ))}
    </div>
  );
}

interface DockIconProps {
  item: DockItem;
  onClick?: () => void;
}

function DockIcon({ item, onClick }: DockIconProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={(e) => {
        if (item.href.startsWith('#')) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'relative flex items-center justify-center rounded-xl',
        'w-12 h-12',
        'bg-gray-100 dark:bg-gray-800',
        'hover:bg-gray-200 dark:hover:bg-gray-700',
        'hover:scale-125 hover:shadow-lg',
        'transition-all duration-200 ease-out',
        'group'
      )}
    >
      <Icon className="h-6 w-6 text-gray-700 dark:text-gray-300" />

      {/* Badge */}
      {item.badge && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
          {item.badge}
        </span>
      )}

      {/* Tooltip */}
      <span className={cn(
        'absolute -top-10 left-1/2 -translate-x-1/2',
        'whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1',
        'text-xs text-white',
        'opacity-0 group-hover:opacity-100',
        'transition-opacity duration-200',
        'pointer-events-none',
        'dark:bg-gray-100 dark:text-gray-900'
      )}>
        {item.label}
      </span>
    </Link>
  );
}

export default FloatingDock;
