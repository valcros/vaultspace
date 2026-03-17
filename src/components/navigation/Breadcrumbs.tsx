'use client';

/**
 * Breadcrumb Navigation Component (F124)
 *
 * Displays: Home > Rooms > RoomName > FolderName > DocumentName
 * Each breadcrumb is clickable and links to its parent.
 */

import React from 'react';
import Link from 'next/link';

interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center text-sm ${className}`}>
      <ol className="flex items-center space-x-2">
        {/* Home link */}
        <li>
          <Link href="/" className="text-gray-500 transition-colors hover:text-gray-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            <span className="sr-only">Home</span>
          </Link>
        </li>

        {items.map((item, index) => (
          <li key={index} className="flex items-center">
            {/* Separator */}
            <svg
              className="mx-2 h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* Breadcrumb item */}
            {item.href && !item.current ? (
              <Link
                href={item.href}
                className="max-w-xs truncate text-gray-500 transition-colors hover:text-gray-700"
                title={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={`max-w-xs truncate ${
                  item.current ? 'font-medium text-gray-900' : 'text-gray-500'
                }`}
                title={item.label}
                aria-current={item.current ? 'page' : undefined}
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

/**
 * Build breadcrumb items for a room context
 */
export function buildRoomBreadcrumbs(
  roomName: string,
  roomId: string,
  options?: {
    folderPath?: string;
    folderName?: string;
    folderId?: string;
    documentName?: string;
    documentId?: string;
  }
): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    {
      label: 'Rooms',
      href: '/rooms',
    },
    {
      label: roomName,
      href: `/rooms/${roomId}`,
    },
  ];

  // Add folder if present
  if (options?.folderName && options?.folderId) {
    items.push({
      label: options.folderName,
      href: `/rooms/${roomId}/folders/${options.folderId}`,
    });
  }

  // Add document if present (current page)
  if (options?.documentName) {
    items.push({
      label: options.documentName,
      current: true,
    });
  } else if (options?.folderName) {
    // Folder is current page
    const lastItem = items[items.length - 1];
    if (lastItem) {
      lastItem.current = true;
      delete lastItem.href;
    }
  } else {
    // Room is current page
    const lastItem = items[items.length - 1];
    if (lastItem) {
      lastItem.current = true;
      delete lastItem.href;
    }
  }

  return items;
}

/**
 * Build breadcrumb items for settings pages
 */
export function buildSettingsBreadcrumbs(
  sections: Array<{ label: string; href?: string }>
): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    {
      label: 'Settings',
      href: '/settings',
    },
  ];

  sections.forEach((section, index) => {
    const isLast = index === sections.length - 1;
    items.push({
      label: section.label,
      href: isLast ? undefined : section.href,
      current: isLast,
    });
  });

  return items;
}
