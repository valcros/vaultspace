'use client';

import * as React from 'react';
import { clsx } from 'clsx';

interface AdminPageContentProps {
  children: React.ReactNode;
  className?: string;
}

export function AdminPageContent({ children, className }: AdminPageContentProps) {
  return <div className={clsx('space-y-6', className)}>{children}</div>;
}

interface AdminSurfaceProps {
  children: React.ReactNode;
  className?: string;
}

export function AdminSurface({ children, className }: AdminSurfaceProps) {
  return (
    <section
      className={clsx(
        'bg-white/96 dark:bg-slate-950/92 rounded-[1.5rem] border border-slate-200/90 p-4 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.28)] ring-1 ring-white/70 backdrop-blur-sm dark:border-slate-700 dark:ring-white/5 sm:p-5',
        className
      )}
    >
      {children}
    </section>
  );
}

interface AdminToolbarProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function AdminToolbar({
  title,
  description,
  actions,
  children,
  className,
}: AdminToolbarProps) {
  return (
    <AdminSurface className={clsx('space-y-4', className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {(title || description) && (
            <div>
              {title && (
                <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  {description}
                </p>
              )}
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </AdminSurface>
  );
}

interface AdminEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function AdminEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <AdminSurface className={clsx('px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-300">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">
        {description}
      </p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </AdminSurface>
  );
}
