'use client';

import * as React from 'react';
import { BookOpen, Bookmark, MessageCircleQuestion } from 'lucide-react';
import Link from 'next/link';

export interface YourWorkItem {
  key: string;
  label: string;
  detail?: string;
  href: string;
  icon: 'continue' | 'bookmark' | 'question';
}

const itemIcons = {
  continue: BookOpen,
  bookmark: Bookmark,
  question: MessageCircleQuestion,
} as const;

/**
 * Slim personal-return strip: continue reading, bookmarks, and the caller's
 * questions stay one click away without bringing back a widget grid.
 * Renders nothing when the user has no work in flight.
 */
export function YourWorkStrip({ items }: { items: YourWorkItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Your work" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="font-medium text-neutral-500 dark:text-neutral-400">Your work</span>
      {items.map((item) => {
        const Icon = itemIcons[item.icon];
        return (
          <Link
            key={item.key}
            href={item.href}
            className="group inline-flex max-w-full items-center gap-1.5 text-neutral-700 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-neutral-300 dark:hover:text-primary-300"
          >
            <Icon
              className="h-4 w-4 shrink-0 text-neutral-400 group-hover:text-primary-600 dark:group-hover:text-primary-400"
              aria-hidden="true"
            />
            <span className="truncate underline-offset-4 group-hover:underline">
              {item.label}
              {item.detail && (
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {' '}
                  {item.detail}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
