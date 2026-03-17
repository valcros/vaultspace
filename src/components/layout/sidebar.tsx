'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FolderOpen,
  Users,
  UsersRound,
  Activity,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: 'Rooms', href: '/rooms', icon: FolderOpen },
  { label: 'Users', href: '/users', icon: Users },
  { label: 'Groups', href: '/groups', icon: UsersRound },
  { label: 'Activity', href: '/activity', icon: Activity },
  { label: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  user: {
    name: string;
    email: string;
    imageUrl?: string | null;
  };
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ user, collapsed = false, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={clsx(
        'flex h-full flex-col border-r border-neutral-200 bg-white transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4">
        {!collapsed && (
          <Link href="/rooms" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">
              V
            </div>
            <span className="font-semibold text-neutral-900">VaultSpace</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/rooms" className="mx-auto">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">
              V
            </div>
          </Link>
        )}
        {onCollapsedChange && !collapsed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange(true)}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse button (when collapsed) */}
      {onCollapsedChange && collapsed && (
        <div className="p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange(false)}
            className="mx-auto flex h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Separator />

      {/* User Profile */}
      <div className={clsx('p-4', collapsed && 'px-2')}>
        <div className={clsx('flex items-center gap-3', collapsed && 'flex-col justify-center')}>
          <UserAvatar name={user.name} imageUrl={user.imageUrl} size="sm" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900">{user.name}</p>
              <p className="truncate text-xs text-neutral-500">{user.email}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-neutral-500 hover:text-neutral-900"
            title="Log out"
            asChild
          >
            <Link href="/auth/logout">
              <LogOut className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </aside>
  );
}
