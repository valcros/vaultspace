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
        '-mx-4 -mt-4 mb-4 rounded-b-xl bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-4 lg:-mx-6 lg:-mt-6 lg:px-8 lg:py-5',
        className
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs
          items={breadcrumbs}
          className="mb-2 [&_a]:text-primary-200 [&_span]:text-primary-200 [&_svg]:text-primary-300"
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-primary-100">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
