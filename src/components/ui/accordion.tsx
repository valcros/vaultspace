'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface AccordionItemProps {
  id: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'danger';
}

export function AccordionItem({
  title,
  description,
  badge,
  icon: Icon,
  isOpen,
  onToggle,
  children,
  variant = 'default',
}: AccordionItemProps) {
  return (
    <div
      className={clsx(
        'overflow-hidden rounded-2xl border transition-all duration-200',
        variant === 'danger'
          ? 'border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/20'
          : 'border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/70',
        isOpen && (variant === 'danger' ? 'ring-1 ring-red-500/30' : 'ring-1 ring-indigo-500/20')
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
      >
        <div className="flex items-center space-x-3.5">
          {Icon && (
            <div
              className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-xl font-bold shadow-sm',
                variant === 'danger'
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                  : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div>
            <div className="flex items-center space-x-3">
              <h3
                className={clsx(
                  'text-base font-semibold tracking-tight',
                  variant === 'danger'
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-slate-900 dark:text-white'
                )}
              >
                {title}
              </h3>
              {badge}
            </div>
            {description && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <ChevronDown
            className={clsx(
              'h-5 w-5 text-slate-400 transition-transform duration-300',
              isOpen && 'rotate-180 text-indigo-600 dark:text-indigo-400'
            )}
          />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 p-6 dark:border-slate-800/80">{children}</div>
      )}
    </div>
  );
}
