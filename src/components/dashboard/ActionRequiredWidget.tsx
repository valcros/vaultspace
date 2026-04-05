'use client';

import * as React from 'react';
import { AlertCircle, HelpCircle, UserPlus } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface ActionItem {
  id: string;
  type: 'question' | 'access_request' | 'review';
  title: string;
  description: string;
  roomId: string;
  roomName: string;
  createdAt: string;
  priority: 'high' | 'normal';
}

interface ActionRequiredWidgetProps {
  totalCount: number;
  unansweredQuestions: number;
  pendingAccessRequests: number;
  items: ActionItem[];
  loading?: boolean;
}

const typeIcons = {
  question: <HelpCircle className="h-4 w-4" />,
  access_request: <UserPlus className="h-4 w-4" />,
  review: <AlertCircle className="h-4 w-4" />,
};

const typeLabels = {
  question: 'Question',
  access_request: 'Access Request',
  review: 'Review',
};

export function ActionRequiredWidget({ totalCount, items, loading }: ActionRequiredWidgetProps) {
  return (
    <DashboardWidget
      title="Action Required"
      icon={<AlertCircle className="h-4 w-4" />}
      badge={totalCount}
      loading={loading}
      empty={items.length === 0}
      emptyMessage="No pending actions"
    >
      <div className="space-y-1">
        {items.slice(0, 5).map((item) => (
          <WidgetListItem
            key={item.id}
            icon={typeIcons[item.type]}
            title={item.title}
            subtitle={`${item.roomName} - ${typeLabels[item.type]}`}
            badge={item.priority === 'high' ? 'Urgent' : undefined}
            badgeColor={item.priority === 'high' ? 'error' : 'neutral'}
            href={
              item.type === 'question'
                ? `/rooms/${item.roomId}/questions/${item.id}`
                : item.type === 'access_request'
                  ? `/rooms/${item.roomId}/access-requests`
                  : `/rooms/${item.roomId}`
            }
            timestamp={formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
