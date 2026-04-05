'use client';

import * as React from 'react';
import {
  Activity,
  Upload,
  Eye,
  Download,
  UserPlus,
  FileText,
  FolderPlus,
  Edit,
  Trash,
  Link as LinkIcon,
  HelpCircle,
} from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface ActivityItem {
  id: string;
  eventType: string;
  actorName: string;
  actorEmail?: string;
  description: string;
  roomId?: string;
  roomName?: string;
  documentId?: string;
  documentName?: string;
  createdAt: string;
}

interface RecentActivityWidgetProps {
  activities: ActivityItem[];
  loading?: boolean;
}

const eventIcons: Record<string, React.ReactNode> = {
  DOCUMENT_UPLOADED: <Upload className="h-4 w-4" />,
  DOCUMENT_VIEWED: <Eye className="h-4 w-4" />,
  DOCUMENT_DOWNLOADED: <Download className="h-4 w-4" />,
  DOCUMENT_UPDATED: <Edit className="h-4 w-4" />,
  DOCUMENT_DELETED: <Trash className="h-4 w-4" />,
  USER_INVITED: <UserPlus className="h-4 w-4" />,
  USER_CREATED: <UserPlus className="h-4 w-4" />,
  ROOM_CREATED: <FolderPlus className="h-4 w-4" />,
  LINK_CREATED: <LinkIcon className="h-4 w-4" />,
  LINK_ACCESSED: <LinkIcon className="h-4 w-4" />,
  QUESTION_SUBMITTED: <HelpCircle className="h-4 w-4" />,
  ANSWER_SUBMITTED: <HelpCircle className="h-4 w-4" />,
};

function formatEventDescription(event: ActivityItem): string {
  // Use description if available, otherwise format event type
  if (event.description) {
    return event.description;
  }

  const action = event.eventType.replace(/_/g, ' ').toLowerCase();
  const parts = [action];

  if (event.documentName) {
    parts.push(`"${event.documentName}"`);
  }

  if (event.roomName) {
    parts.push(`in ${event.roomName}`);
  }

  return parts.join(' ');
}

export function RecentActivityWidget({ activities, loading }: RecentActivityWidgetProps) {
  return (
    <DashboardWidget
      title="Recent Activity"
      icon={<Activity className="h-4 w-4" />}
      viewAllHref="/activity"
      loading={loading}
      empty={activities.length === 0}
      emptyMessage="No recent activity"
    >
      <div className="space-y-1">
        {activities.slice(0, 8).map((activity) => (
          <WidgetListItem
            key={activity.id}
            icon={eventIcons[activity.eventType] || <FileText className="h-4 w-4" />}
            title={activity.actorName}
            subtitle={formatEventDescription(activity)}
            href={
              activity.documentId && activity.roomId
                ? `/rooms/${activity.roomId}/documents/${activity.documentId}`
                : activity.roomId
                  ? `/rooms/${activity.roomId}`
                  : undefined
            }
            timestamp={formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}

// Timeline version for more detailed view
export function ActivityTimeline({ activities, loading }: RecentActivityWidgetProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-700" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-700" />
              <div className="h-2 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 h-full w-px bg-neutral-200 dark:bg-neutral-700" />
      <ul className="space-y-4">
        {activities.map((activity) => (
          <li key={activity.id} className="relative flex gap-3 pl-2">
            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700">
              {eventIcons[activity.eventType] || <Activity className="h-4 w-4 text-neutral-400" />}
            </div>
            <div className="flex-1 pt-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {activity.actorName}
              </p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {formatEventDescription(activity)}
              </p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
