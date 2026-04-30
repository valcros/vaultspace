import * as React from 'react';
import { clsx } from 'clsx';
import { Breadcrumbs, BreadcrumbItem } from './breadcrumbs';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
  /**
   * Visual treatment.
   *
   * - `work` (default) — quiet inline header with no dark band. Right for
   *   the task-heavy admin pages (rooms index, dashboard, users, groups,
   *   settings, room canvas) where the header should hand the page over to
   *   the content as quickly as possible.
   * - `hero` — dark slate band with rounded bottom and large title. Reserve
   *   for overview / landing surfaces where the page header carries product
   *   identity rather than orienting work.
   */
  variant?: 'hero' | 'work';
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
  variant = 'work',
}: PageHeaderProps) {
  if (variant === 'work') {
    return (
      <div className={clsx('mb-4', className)}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumbs items={breadcrumbs} className="mb-2" />
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'relative -mx-4 -mt-4 mb-6 overflow-hidden rounded-b-[1.75rem] bg-slate-900 px-6 py-5 shadow-sm lg:-mx-6 lg:-mt-6 lg:px-8 lg:py-6',
        className
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs
          items={breadcrumbs}
          className="relative mb-3 [&_a]:text-slate-300 [&_span]:text-slate-400 [&_svg]:text-slate-400"
        />
      )}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-300 sm:text-[0.95rem]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
