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
        'relative -mx-4 -mt-4 mb-6 overflow-hidden rounded-b-[1.75rem] border-b border-white/10 bg-gradient-to-br from-slate-950 via-primary-950 to-primary-700 px-6 py-5 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.7)] lg:-mx-6 lg:-mt-6 lg:px-8 lg:py-6',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(96,165,250,0.28),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-white/20" />
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs
          items={breadcrumbs}
          className="relative mb-3 [&_a]:text-primary-100/90 [&_span]:text-primary-100/85 [&_svg]:text-primary-300"
        />
      )}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-primary-100/85 sm:text-[0.95rem]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
