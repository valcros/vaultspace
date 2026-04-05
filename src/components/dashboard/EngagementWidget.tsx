'use client';

import * as React from 'react';
import { BarChart3, Eye, Users, Download } from 'lucide-react';
import { DashboardWidget } from './DashboardWidget';
import { clsx } from 'clsx';
import Link from 'next/link';

interface EngagementData {
  period: '7d' | '30d';
  totalViews: number;
  uniqueViewers: number;
  downloads: number;
  dailyActivity: { date: string; views: number }[];
  topDocuments: { id: string; name: string; roomName: string; views: number }[];
}

interface EngagementWidgetProps {
  data: EngagementData;
  loading?: boolean;
}

export function EngagementWidget({ data, loading }: EngagementWidgetProps) {
  return (
    <DashboardWidget
      title="Engagement (7 days)"
      icon={<BarChart3 className="h-4 w-4" />}
      loading={loading}
      empty={data.totalViews === 0 && data.uniqueViewers === 0}
      emptyMessage="No activity in the last 7 days"
    >
      <div className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={<Eye className="h-4 w-4" />} label="Views" value={data.totalViews} />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Viewers"
            value={data.uniqueViewers}
          />
          <StatCard
            icon={<Download className="h-4 w-4" />}
            label="Downloads"
            value={data.downloads}
          />
        </div>

        {/* Mini chart */}
        <MiniActivityChart data={data.dailyActivity} />

        {/* Top documents */}
        {data.topDocuments.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Top Documents
            </p>
            <ul className="space-y-1">
              {data.topDocuments.slice(0, 3).map((doc, index) => (
                <li key={doc.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <span className="shrink-0 text-neutral-400">{index + 1}.</span>
                    <span className="truncate text-neutral-700 dark:text-neutral-300">
                      {doc.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">{doc.views} views</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-neutral-400 dark:text-neutral-500">
        {icon}
      </div>
      <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}

function MiniActivityChart({ data }: { data: { date: string; views: number }[] }) {
  const maxViews = Math.max(...data.map((d) => d.views), 1);

  return (
    <div className="flex h-16 items-end gap-1">
      {data.map((day) => {
        const height = (day.views / maxViews) * 100;
        const isToday = day.date === new Date().toISOString().split('T')[0];

        return (
          <div
            key={day.date}
            className="group relative flex-1"
            title={`${day.date}: ${day.views} views`}
          >
            <div
              className={clsx(
                'w-full rounded-t transition-all',
                isToday ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-600',
                'group-hover:bg-primary-400'
              )}
              style={{ height: `${Math.max(height, 4)}%` }}
            />
            <div className="absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white group-hover:block dark:bg-neutral-100 dark:text-neutral-900">
              {day.views}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Larger engagement overview card
export function EngagementOverviewCard({ data }: EngagementWidgetProps) {
  if (!data) {
    return null;
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-primary-50 to-white p-5 dark:border-neutral-700 dark:from-primary-900/20 dark:to-neutral-800">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Engagement Overview
        </h3>
        <Link
          href="/analytics"
          className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          View details
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div>
          <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
            {data.totalViews.toLocaleString()}
          </p>
          <p className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
            <Eye className="h-4 w-4" />
            Total views
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
            {data.uniqueViewers.toLocaleString()}
          </p>
          <p className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
            <Users className="h-4 w-4" />
            Unique viewers
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
            {data.downloads.toLocaleString()}
          </p>
          <p className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
            <Download className="h-4 w-4" />
            Downloads
          </p>
        </div>
      </div>
    </div>
  );
}
