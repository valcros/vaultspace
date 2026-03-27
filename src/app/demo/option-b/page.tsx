'use client';

/**
 * Option B Demo: Command Palette Primary Navigation
 *
 * Minimal chrome with ⌘K as the primary navigation method:
 * - Maximum content area
 * - Power-user keyboard-driven workflow
 * - Clean, distraction-free interface
 */

import * as React from 'react';
import { EnhancedCommandMenu, useCommandMenu } from '@/components/ui-proposals/command-menu';
import { cn } from '@/components/ui-proposals/utils';
import { Bell, Command, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function OptionBPage() {
  const { open, setOpen } = useCommandMenu();

  const recentRooms = [
    { id: '1', name: 'Due Diligence Package' },
    { id: '2', name: 'Board Materials Q4' },
    { id: '3', name: 'Series A Funding' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Ultra-Minimal Header */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
        {/* Logo + Back */}
        <div className="flex items-center gap-4">
          <Link
            href="/demo"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-xs font-bold text-white">
            V
          </div>
        </div>

        {/* Central Search - Hero Element */}
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'flex items-center gap-3 rounded-xl px-6 py-2',
            'bg-gray-100 dark:bg-gray-800',
            'text-sm text-gray-500',
            'hover:bg-gray-200 dark:hover:bg-gray-700',
            'hover:shadow-lg',
            'transition-all duration-200',
            'w-96 justify-center',
            'border border-transparent hover:border-blue-200 dark:hover:border-blue-800'
          )}
        >
          <Command className="h-4 w-4" />
          <span>Press ⌘K to navigate, search, or take action</span>
        </button>

        {/* Minimal Right Actions */}
        <div className="flex items-center gap-2">
          <button className="relative rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell className="h-4 w-4 text-gray-500" />
            <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
          </button>
          <button className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-medium text-white">
            J
          </button>
        </div>
      </header>

      {/* Full-Width Content */}
      <main className="p-6">
        <CommandPrimaryContent onOpenSearch={() => setOpen(true)} />
      </main>

      {/* Command Menu */}
      <EnhancedCommandMenu open={open} onOpenChange={setOpen} recentRooms={recentRooms} />

      {/* Option Info Banner */}
      <div className="fixed left-6 top-20 z-40 max-w-xs rounded-lg border border-purple-200 bg-purple-50 p-3 shadow-lg dark:border-purple-900 dark:bg-purple-950">
        <p className="text-xs font-medium text-purple-900 dark:text-purple-100">
          Option B: Command Palette Primary
        </p>
        <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">
          Press ⌘K to open the command palette. All navigation flows through search and keyboard
          shortcuts.
        </p>
      </div>
    </div>
  );
}

function CommandPrimaryContent({ onOpenSearch }: { onOpenSearch: () => void }) {
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
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Welcome Hero */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Welcome back, John</h1>
        <p className="mt-2 text-gray-500">You have 3 rooms with recent activity</p>
        <button
          onClick={onOpenSearch}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          <Command className="h-4 w-4" />
          Quick Search
          <kbd className="ml-2 rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300 dark:bg-gray-300 dark:text-gray-600">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Active Rooms', value: '12', color: 'blue' },
          { label: 'Documents', value: '234', color: 'green' },
          { label: 'Team Members', value: '47', color: 'purple' },
          { label: 'Pending', value: '8', color: 'amber' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Recent Rooms */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Rooms</h2>
          <button
            onClick={onOpenSearch}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            View all →
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            </div>
          ))}
        </div>
      </div>

      {/* Keyboard Shortcuts Reference */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          {[
            { keys: '⌘K', action: 'Open command palette' },
            { keys: '⌘D', action: 'Go to dashboard' },
            { keys: '⌘R', action: 'View all rooms' },
            { keys: '⌘N', action: 'Create new room' },
            { keys: '⌘U', action: 'Manage users' },
            { keys: '⌘,', action: 'Open settings' },
            { keys: '↑↓', action: 'Navigate results' },
            { keys: '↵', action: 'Select item' },
          ].map(({ keys, action }) => (
            <div key={keys} className="flex items-center gap-2">
              <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs dark:bg-gray-800">
                {keys}
              </kbd>
              <span className="text-gray-500">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
