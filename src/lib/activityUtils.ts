/**
 * Activity feed utilities — shared between activity page and room activity tab.
 */

import {
  Upload,
  Eye,
  Trash2,
  Link,
  Shield,
  Settings,
  UserPlus,
  LogIn,
  type LucideIcon,
} from 'lucide-react';

interface EventStyle {
  bg: string;
  text: string;
  icon: LucideIcon;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  // Upload / Create
  DOCUMENT_UPLOADED: { bg: 'bg-blue-100', text: 'text-blue-600', icon: Upload },
  ROOM_CREATED: { bg: 'bg-blue-100', text: 'text-blue-600', icon: Upload },
  FOLDER_CREATED: { bg: 'bg-blue-100', text: 'text-blue-600', icon: Upload },

  // View
  DOCUMENT_VIEWED: { bg: 'bg-green-100', text: 'text-green-600', icon: Eye },
  LINK_ACCESSED: { bg: 'bg-green-100', text: 'text-green-600', icon: Eye },

  // Delete
  DOCUMENT_DELETED: { bg: 'bg-red-100', text: 'text-red-600', icon: Trash2 },
  ROOM_DELETED: { bg: 'bg-red-100', text: 'text-red-600', icon: Trash2 },
  DOCUMENT_RESTORED: { bg: 'bg-amber-100', text: 'text-amber-600', icon: Trash2 },

  // Share / Link
  LINK_CREATED: { bg: 'bg-purple-100', text: 'text-purple-600', icon: Link },
  LINK_UPDATED: { bg: 'bg-purple-100', text: 'text-purple-600', icon: Link },
  LINK_REVOKED: { bg: 'bg-purple-100', text: 'text-purple-600', icon: Link },
  PERMISSION_GRANTED: { bg: 'bg-purple-100', text: 'text-purple-600', icon: Shield },
  PERMISSION_REVOKED: { bg: 'bg-purple-100', text: 'text-purple-600', icon: Shield },

  // Auth / User
  USER_LOGIN: { bg: 'bg-neutral-100', text: 'text-neutral-600', icon: LogIn },
  USER_INVITED: { bg: 'bg-indigo-100', text: 'text-indigo-600', icon: UserPlus },
  MEMBER_ADDED: { bg: 'bg-indigo-100', text: 'text-indigo-600', icon: UserPlus },
  MEMBER_REMOVED: { bg: 'bg-red-100', text: 'text-red-600', icon: UserPlus },

  // Settings
  ROOM_UPDATED: { bg: 'bg-amber-100', text: 'text-amber-600', icon: Settings },
  ORGANIZATION_UPDATED: { bg: 'bg-amber-100', text: 'text-amber-600', icon: Settings },
};

const DEFAULT_STYLE: EventStyle = {
  bg: 'bg-neutral-100',
  text: 'text-neutral-500',
  icon: Eye,
};

export function getEventStyle(eventType: string): EventStyle {
  return EVENT_STYLES[eventType] ?? DEFAULT_STYLE;
}

/**
 * Group events by date label (Today, Yesterday, or specific date)
 */
export function groupEventsByDate<T extends { createdAt: string }>(
  events: T[]
): { label: string; events: T[] }[] {
  const groups = new Map<string, T[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const event of events) {
    const date = new Date(event.createdAt);
    date.setHours(0, 0, 0, 0);

    let label: string;
    if (date.getTime() === today.getTime()) {
      label = 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(event);
  }

  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
}
