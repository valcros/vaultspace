'use client';

/**
 * Option A Demo: Floating Dock Navigation
 *
 * macOS-style floating dock at the bottom with:
 * - Magnification effect on hover
 * - Full-width content area
 * - Glassmorphism styling
 */

import * as React from 'react';
import { FloatingDock } from '@/components/ui-proposals/floating-dock';
import { EnhancedCommandMenu, useCommandMenu } from '@/components/ui-proposals/command-menu';
import { cn } from '@/components/ui-proposals/utils';
import { Search, Bell, ChevronRight, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function OptionAPage() {
  const { open, setOpen } = useCommandMenu();

  const recentRooms = [
    { id: '1', name: 'Due Diligence Package' },
    { id: '2', name: 'Board Materials Q4' },
    { id: '3', name: 'Series A Funding' },
  ];

  const handleDockItemClick = (item: { id: string; href: string }) => {
    if (item.href === '#search') {
      setOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Top Header - Minimal */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
        {/* Back + Breadcrumb */}
        <div className="flex items-center gap-4">
          <Link
            href="/demo"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <nav className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-gray-900 dark:text-gray-100">VaultSpace</span>
            <ChevronRight className="h-4 w-4 text-gray-400" />
            <span className="text-gray-500">Rooms</span>
          </nav>
        </div>

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

      {/* Main Content - Full Width, Bottom Padding for Dock */}
      <main className="p-6 pb-24">
        <DemoRoomsContent />
      </main>

      {/* Floating Dock */}
      <FloatingDock onItemClick={handleDockItemClick} />

      {/* Command Menu */}
      <EnhancedCommandMenu open={open} onOpenChange={setOpen} recentRooms={recentRooms} />

      {/* Option Info Banner */}
      <div className="fixed left-6 top-20 z-40 max-w-xs rounded-lg border border-blue-200 bg-blue-50 p-3 shadow-lg dark:border-blue-900 dark:bg-blue-950">
        <p className="text-xs font-medium text-blue-900 dark:text-blue-100">
          Option A: Floating Dock
        </p>
        <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
          Hover over dock icons at the bottom to see magnification effect. Full content width, no
          sidebar.
        </p>
      </div>
    </div>
  );
}

function DemoRoomsContent() {
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
    {
      id: '5',
      name: 'HR Documents',
      status: 'active',
      documents: 34,
      members: 6,
      lastActivity: '5 hours ago',
    },
    {
      id: '6',
      name: 'Compliance Audit',
      status: 'active',
      documents: 56,
      members: 10,
      lastActivity: '1 hour ago',
    },
  ];

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    draft: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    archived: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Data Rooms</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your secure document rooms</p>
        </div>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + Create Room
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 lg:grid-cols-4">
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
            <h3 className="mt-3 font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100">
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
