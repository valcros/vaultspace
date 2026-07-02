'use client';

import * as React from 'react';
import { Inbox, MessageCircleQuestion, UserPlus } from 'lucide-react';
import Link from 'next/link';

export interface AttentionChip {
  key: string;
  label: string;
  href: string;
  icon: 'question' | 'access' | 'inbox';
}

const chipIcons = {
  question: MessageCircleQuestion,
  access: UserPlus,
  inbox: Inbox,
} as const;

/**
 * Actionable-only signals for the landing page. Every chip is a count plus a
 * destination; the strip renders nothing at all when there is nothing to act on.
 */
export function AttentionStrip({ chips }: { chips: AttentionChip[] }) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Needs your attention" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => {
        const Icon = chipIcons[chip.icon];
        return (
          <Link
            key={chip.key}
            href={chip.href}
            className="inline-flex items-center gap-2 rounded-full border border-warning-300 bg-warning-50 px-3.5 py-1.5 text-sm font-medium text-warning-900 transition-colors hover:border-warning-400 hover:bg-warning-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-200 dark:hover:bg-warning-900/50"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{chip.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
