'use client';

/**
 * Icon Rail Component - Thin sidebar with tooltips
 *
 * This is a PROTOTYPE component for UI modernization proposal.
 * Similar to VSCode, Figma, Slack icon rails.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './utils';
import {
  Home,
  FolderOpen,
  Users,
  Activity,
  Settings,
  HelpCircle,
  Bell,
  type LucideIcon,
} from 'lucide-react';

interface RailItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: number;
  position?: 'top' | 'bottom';
}

const defaultItems: RailItem[] = [
  { id: 'home', label: 'Dashboard', icon: Home, href: '/rooms', position: 'top' },
  { id: 'rooms', label: 'Rooms', icon: FolderOpen, href: '/rooms', badge: 3, position: 'top' },
  { id: 'users', label: 'Users', icon: Users, href: '/users', position: 'top' },
  { id: 'activity', label: 'Activity', icon: Activity, href: '/activity', position: 'top' },
  { id: 'notifications', label: 'Notifications', icon: Bell, href: '#notifications', badge: 5, position: 'bottom' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings', position: 'bottom' },
  { id: 'help', label: 'Help & Support', icon: HelpCircle, href: '/help', position: 'bottom' },
];

interface IconRailProps {
  items?: RailItem[];
  className?: string;
  logo?: React.ReactNode;
}

export function IconRail({
  items = defaultItems,
  className,
  logo,
}: IconRailProps) {
  const pathname = usePathname();

  const topItems = items.filter((item) => item.position !== 'bottom');
  const bottomItems = items.filter((item) => item.position === 'bottom');

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen w-14 flex-col',
        'bg-white dark:bg-gray-950',
        'border-r border-gray-200 dark:border-gray-800',
        className
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b border-gray-200 dark:border-gray-800">
        {logo || (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 font-bold text-white shadow-md">
            V
          </div>
        )}
      </div>

      {/* Top Navigation */}
      <nav className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
        {topItems.map((item) => (
          <RailIcon
            key={item.id}
            item={item}
            isActive={pathname?.startsWith(item.href) || false}
          />
        ))}
      </nav>

      {/* Bottom Navigation */}
      <nav className="flex flex-col items-center gap-1 border-t border-gray-200 px-2 py-3 dark:border-gray-800">
        {bottomItems.map((item) => (
          <RailIcon
            key={item.id}
            item={item}
            isActive={pathname?.startsWith(item.href) || false}
          />
        ))}
      </nav>
    </aside>
  );
}

interface RailIconProps {
  item: RailItem;
  isActive: boolean;
}

function RailIcon({ item, isActive }: RailIconProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-lg',
        'transition-all duration-200',
        'group',
        isActive
          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
      )}
    >
      <Icon className="h-5 w-5" />

      {/* Badge */}
      {item.badge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      )}

      {/* Active Indicator */}
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-blue-600" />
      )}

      {/* Tooltip */}
      <span className={cn(
        'absolute left-full ml-2 z-50',
        'whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1',
        'text-xs font-medium text-white',
        'opacity-0 group-hover:opacity-100',
        'transition-opacity duration-200',
        'pointer-events-none',
        'dark:bg-gray-100 dark:text-gray-900'
      )}>
        {item.label}
        {item.badge && (
          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-900/50 dark:text-red-400">
            {item.badge}
          </span>
        )}
      </span>
    </Link>
  );
}

export default IconRail;
