'use client';

/**
 * DockHeader - Minimal header for floating dock layout
 *
 * Removes sidebar toggle, keeps:
 * - Search trigger (opens command palette)
 * - Notifications
 * - User menu
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Search, Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { clsx } from 'clsx';

interface DockHeaderProps {
  user: {
    name: string;
    email: string;
    imageUrl?: string | null;
  };
  onSearchClick?: () => void;
}

export function DockHeader({ user, onSearchClick }: DockHeaderProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-xl lg:px-6">
      {/* Logo */}
      <Link href="/rooms" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">
          V
        </div>
        <span className="hidden font-semibold text-neutral-900 sm:inline">VaultSpace</span>
      </Link>

      {/* Center: Search Trigger */}
      <button
        onClick={onSearchClick}
        className={clsx(
          'flex items-center gap-3 rounded-xl px-4 py-2',
          'bg-neutral-100 dark:bg-neutral-800',
          'text-sm text-neutral-500',
          'hover:bg-neutral-200 dark:hover:bg-neutral-700',
          'transition-colors duration-200',
          'w-64 md:w-80'
        )}
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search...</span>
        <div className="hidden items-center gap-1 sm:flex">
          <kbd className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700">
            <Command className="inline h-3 w-3" />
          </kbd>
          <kbd className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700">K</kbd>
        </div>
      </button>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-500" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <UserAvatar name={user.name} imageUrl={user.imageUrl} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs leading-none text-neutral-500">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/notifications">Notifications</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-danger-600">
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default DockHeader;
