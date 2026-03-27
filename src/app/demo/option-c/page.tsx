'use client';

/**
 * Option C Demo: Widget Dashboard + Contextual Panels
 *
 * Customizable widget-based dashboard with:
 * - Draggable/resizable widgets
 * - Personalized layout
 * - Slide-in contextual panels
 *
 * Status: Planned - showing mockup preview
 */

import * as React from 'react';
import { cn } from '@/components/ui-proposals/utils';
import {
  LayoutGrid,
  ArrowLeft,
  FolderOpen,
  Users,
  Activity,
  Bell,
  Settings,
  ChevronRight,
  GripVertical,
  Maximize2,
  X,
} from 'lucide-react';
import Link from 'next/link';

export default function OptionCPage() {
  const [selectedRoom, setSelectedRoom] = React.useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
        <div className="flex items-center gap-4">
          <Link
            href="/demo"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-sm font-bold text-white">
            V
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            VaultSpace Dashboard
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Settings className="h-4 w-4" />
          </button>
          <button className="relative rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell className="h-5 w-5 text-gray-500" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-medium text-white">
            JD
          </button>
        </div>
      </header>

      {/* Widget Dashboard */}
      <main className="p-6">
        <div className="grid grid-cols-12 gap-4">
          {/* Quick Stats - Full Width */}
          <div className="col-span-12">
            <WidgetContainer title="Quick Stats" icon={Activity}>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Active Rooms', value: '12', trend: '+2', color: 'blue' },
                  { label: 'Documents', value: '234', trend: '+23', color: 'green' },
                  { label: 'Team Members', value: '47', trend: '+5', color: 'purple' },
                  { label: 'Pending Reviews', value: '8', trend: '3 urgent', color: 'amber' },
                ].map((stat) => (
                  <div key={stat.label} className="text-center">
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
                    <p className="text-sm text-gray-500">{stat.label}</p>
                    <p className={`text-xs text-${stat.color}-600`}>{stat.trend}</p>
                  </div>
                ))}
              </div>
            </WidgetContainer>
          </div>

          {/* Recent Rooms - Left Column */}
          <div className="col-span-8">
            <WidgetContainer title="Recent Rooms" icon={FolderOpen}>
              <div className="space-y-2">
                {[
                  { id: '1', name: 'Due Diligence Package', activity: '2 hours ago', docs: 47 },
                  { id: '2', name: 'Board Materials Q4', activity: '1 day ago', docs: 23 },
                  { id: '3', name: 'Series A Funding', activity: '3 days ago', docs: 15 },
                ].map((room) => (
                  <button
                    key={room.id}
                    onClick={() => setSelectedRoom(room.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg p-3',
                      'hover:bg-gray-50 dark:hover:bg-gray-800',
                      'transition-colors duration-150'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        {room.name[0]}
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{room.name}</p>
                        <p className="text-xs text-gray-500">{room.docs} documents</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {room.activity}
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </button>
                ))}
              </div>
            </WidgetContainer>
          </div>

          {/* Activity Feed - Right Column */}
          <div className="col-span-4">
            <WidgetContainer title="Activity" icon={Activity}>
              <div className="space-y-3">
                {[
                  { user: 'John D.', action: 'uploaded 3 files', time: '5 min ago' },
                  { user: 'Sarah M.', action: 'viewed Legal docs', time: '12 min ago' },
                  { user: 'Mike R.', action: 'commented on NDA', time: '1 hour ago' },
                  { user: 'Emily K.', action: 'shared room link', time: '2 hours ago' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium dark:bg-gray-700">
                      {item.user.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{item.user}</span> {item.action}
                      </p>
                      <p className="text-xs text-gray-400">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </WidgetContainer>
          </div>

          {/* Team Members */}
          <div className="col-span-6">
            <WidgetContainer title="Team Members" icon={Users}>
              <div className="flex flex-wrap gap-2">
                {['JD', 'SM', 'MR', 'EK', 'AP', 'BT', 'CW', 'DL'].map((initials) => (
                  <div
                    key={initials}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-medium text-white"
                  >
                    {initials}
                  </div>
                ))}
                <button className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:border-gray-600">
                  +
                </button>
              </div>
            </WidgetContainer>
          </div>

          {/* Quick Actions */}
          <div className="col-span-6">
            <WidgetContainer title="Quick Actions" icon={LayoutGrid}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Create Room', color: 'blue' },
                  { label: 'Upload Files', color: 'green' },
                  { label: 'Invite User', color: 'purple' },
                  { label: 'Generate Report', color: 'amber' },
                ].map((action) => (
                  <button
                    key={action.label}
                    className={cn(
                      'rounded-lg p-3 text-sm font-medium',
                      `bg-${action.color}-100 text-${action.color}-700`,
                      `dark:bg-${action.color}-900/30 dark:text-${action.color}-400`,
                      'hover:opacity-80 transition-opacity'
                    )}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </WidgetContainer>
          </div>
        </div>
      </main>

      {/* Slide-in Panel (when room selected) */}
      {selectedRoom && (
        <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
          <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Room Details</h3>
            <button
              onClick={() => setSelectedRoom(null)}
              className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-500">
              Contextual panel showing room details, documents, and actions.
              Click outside or X to close.
            </p>
          </div>
        </div>
      )}

      {/* Option Info Banner */}
      <div className="fixed left-6 top-20 z-40 max-w-xs rounded-lg border border-green-200 bg-green-50 p-3 shadow-lg dark:border-green-900 dark:bg-green-950">
        <p className="text-xs font-medium text-green-900 dark:text-green-100">
          Option C: Widget Dashboard
        </p>
        <p className="mt-1 text-xs text-green-700 dark:text-green-300">
          Customizable widgets with drag handles. Click a room to see the slide-in panel.
          Full implementation would include drag-and-drop reordering.
        </p>
      </div>
    </div>
  );
}

function WidgetContainer({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 cursor-grab text-gray-300 dark:text-gray-600" />
          <Icon className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
        </div>
        <button className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <Maximize2 className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
