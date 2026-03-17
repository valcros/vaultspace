'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { clsx } from 'clsx';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={clsx('flex items-center', className)}>
      <ol className="flex items-center space-x-1 text-sm text-neutral-500">
        <li>
          <Link
            href="/rooms"
            className="flex items-center transition-colors hover:text-neutral-900"
          >
            <Home className="h-4 w-4" />
            <span className="sr-only">Home</span>
          </Link>
        </li>
        {items.map((item, index) => (
          <li key={index} className="flex items-center">
            <ChevronRight className="mx-1 h-4 w-4 flex-shrink-0" />
            {item.href && index < items.length - 1 ? (
              <Link
                href={item.href}
                className="max-w-[200px] truncate transition-colors hover:text-neutral-900"
                title={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={clsx(
                  'max-w-[200px] truncate',
                  index === items.length - 1 && 'font-medium text-neutral-900'
                )}
                title={item.label}
                aria-current={index === items.length - 1 ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
