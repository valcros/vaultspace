'use client';

/**
 * Demo Layout - Option D Implementation
 *
 * This is a PROTOTYPE layout demonstrating the hybrid
 * Icon Rail + Command Palette navigation approach.
 *
 * To preview: Visit /demo in the browser
 */

import * as React from 'react';
import { IconRail } from './icon-rail';
import { EnhancedCommandMenu, useCommandMenu } from './command-menu';
import { cn } from './utils';
import { Search, Bell, ChevronRight } from 'lucide-react';

interface DemoLayoutProps {
  children: React.ReactNode;
}

export function DemoLayout({ children }: DemoLayoutProps) {
  const { open, setOpen } = useCommandMenu();

  // Demo data
  const recentRooms = [
    { id: '1', name: 'Due Diligence Package' },
    { id: '2', name: 'Board Materials Q4' },
    { id: '3', name: 'Series A Funding' },
  ];

  const favoriteRooms = [{ id: '1', name: 'Due Diligence Package' }];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Icon Rail */}
      <IconRail />

      {/* Main Content Area */}
      <div className="pl-14">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-gray-900 dark:text-gray-100">VaultSpace</span>
            <ChevronRight className="h-4 w-4 text-gray-400" />
            <span className="text-gray-500">Rooms</span>
          </nav>

          {/* Search Trigger */}
          <button
            onClick={() => setOpen(true)}
            className={cn(
              'flex items-center gap-3 rounded-lg px-4 py-2',
              'bg-gray-100 dark:bg-gray-800',
              'text-sm text-gray-500',
              'hover:bg-gray-200 dark:hover:bg-gray-700',
              'transition-colors duration-200',
              'w-64'
            )}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="rounded bg-gray-200 px-1.5 py-0.5 text-xs dark:bg-gray-700">⌘K</kbd>
          </button>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <button className="relative rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800">
              <Bell className="h-5 w-5 text-gray-500" />
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-medium text-white">
              JD
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">{children}</main>
      </div>

      {/* Command Menu */}
      <EnhancedCommandMenu
        open={open}
        onOpenChange={setOpen}
        recentRooms={recentRooms}
        favoriteRooms={favoriteRooms}
      />
    </div>
  );
}

/**
 * Demo Content - Sample rooms grid to showcase the layout
 */
export function DemoContent() {
  const rooms = [
    {
      id: '1',
      name: 'Due Diligence Package',
      status: 'active',
      documents: 47,
      members: 12,
      lastActivity: '2 hours ago',
    },
    {
      id: '2',
      name: 'Board Materials Q4',
      status: 'active',
      documents: 23,
      members: 8,
      lastActivity: '1 day ago',
    },
    {
      id: '3',
      name: 'Series A Funding',
      status: 'draft',
      documents: 15,
      members: 5,
      lastActivity: '3 days ago',
    },
    {
      id: '4',
      name: 'Legal Review',
      status: 'archived',
      documents: 89,
      members: 15,
      lastActivity: '2 weeks ago',
    },
  ];

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    draft: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    archived: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Data Rooms</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your secure document rooms</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
          <span>+ Create Room</span>
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Rooms', value: '12', change: '+2 this month' },
          { label: 'Active Users', value: '47', change: '+5 this week' },
          { label: 'Documents', value: '234', change: '+23 today' },
          { label: 'Pending Reviews', value: '8', change: '3 urgent' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
            <p className="mt-1 text-xs text-gray-400">{stat.change}</p>
          </div>
        ))}
      </div>

      {/* Rooms Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {rooms.map((room) => (
          <div
            key={room.id}
            className={cn(
              'group rounded-xl border border-gray-200 bg-white p-5',
              'dark:border-gray-800 dark:bg-gray-900',
              'hover:border-blue-300 hover:shadow-lg dark:hover:border-blue-700',
              'cursor-pointer transition-all duration-200'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <span className="text-lg font-bold">{room.name[0]}</span>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-1 text-xs font-medium capitalize',
                  statusColors[room.status]
                )}
              >
                {room.status}
              </span>
            </div>

            <h3 className="mt-3 font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
              {room.name}
            </h3>

            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>{room.documents} docs</span>
              <span>{room.members} members</span>
            </div>

            <p className="mt-2 text-xs text-gray-400">Last activity: {room.lastActivity}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DemoLayout;
