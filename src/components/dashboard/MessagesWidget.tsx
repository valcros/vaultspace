'use client';

import * as React from 'react';
import { Mail, MailOpen } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface MessagePreview {
  id: string;
  senderName: string;
  subject: string;
  preview: string;
  createdAt: string;
  isRead: boolean;
  roomName?: string;
}

interface MessagesWidgetProps {
  unreadCount: number;
  messages: MessagePreview[];
  loading?: boolean;
}

export function MessagesWidget({ unreadCount, messages, loading }: MessagesWidgetProps) {
  return (
    <DashboardWidget
      title="Messages"
      icon={<Mail className="h-4 w-4" />}
      badge={unreadCount}
      viewAllHref="/messages"
      loading={loading}
      empty={messages.length === 0}
      emptyMessage="No messages"
    >
      <div className="space-y-1">
        {messages.slice(0, 5).map((message) => (
          <WidgetListItem
            key={message.id}
            icon={
              message.isRead ? (
                <MailOpen className="h-4 w-4" />
              ) : (
                <Mail className="h-4 w-4 text-primary-600" />
              )
            }
            title={message.subject}
            subtitle={`From ${message.senderName}${message.roomName ? ` - ${message.roomName}` : ''}`}
            href="/messages"
            timestamp={formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
