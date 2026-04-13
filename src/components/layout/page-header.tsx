import * as React from 'react';
import { clsx } from 'clsx';
import { Breadcrumbs, BreadcrumbItem } from './breadcrumbs';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
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
