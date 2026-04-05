'use client';

import * as React from 'react';
import { HelpCircle, MessageCircle, CheckCircle, XCircle } from 'lucide-react';
import { DashboardWidget, WidgetListItem } from './DashboardWidget';
import { formatDistanceToNow } from 'date-fns';

interface QuestionSummary {
  id: string;
  question: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  roomName: string;
  documentName?: string;
  createdAt: string;
  answeredAt?: string;
}

interface MyQuestionsWidgetProps {
  questions: QuestionSummary[];
  loading?: boolean;
}

const statusIcons = {
  OPEN: <HelpCircle className="h-4 w-4 text-amber-500" />,
  ANSWERED: <CheckCircle className="h-4 w-4 text-green-500" />,
  CLOSED: <XCircle className="h-4 w-4 text-neutral-400" />,
};

const statusLabels = {
  OPEN: 'Pending',
  ANSWERED: 'Answered',
  CLOSED: 'Closed',
};

const statusColors: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'error'> = {
  OPEN: 'warning',
  ANSWERED: 'success',
  CLOSED: 'neutral',
};

export function MyQuestionsWidget({ questions, loading }: MyQuestionsWidgetProps) {
  const pendingCount = questions.filter((q) => q.status === 'OPEN').length;

  return (
    <DashboardWidget
      title="My Questions"
      icon={<MessageCircle className="h-4 w-4" />}
      badge={pendingCount > 0 ? `${pendingCount} pending` : undefined}
      loading={loading}
      empty={questions.length === 0}
      emptyMessage="No questions asked"
    >
      <div className="space-y-1">
        {questions.slice(0, 5).map((question) => (
          <WidgetListItem
            key={question.id}
            icon={statusIcons[question.status]}
            title={question.question}
            subtitle={
              question.documentName
                ? `${question.roomName} - ${question.documentName}`
                : question.roomName
            }
            badge={statusLabels[question.status]}
            badgeColor={statusColors[question.status]}
            href={`/questions/${question.id}`}
            timestamp={
              question.answeredAt
                ? `Answered ${formatDistanceToNow(new Date(question.answeredAt), { addSuffix: true })}`
                : formatDistanceToNow(new Date(question.createdAt), { addSuffix: true })
            }
          />
        ))}
      </div>
    </DashboardWidget>
  );
}
