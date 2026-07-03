'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

/**
 * Accessibility: adjustable file/folder name typography (QA request from
 * low-vision testers). Two independent, opt-in aids:
 *
 * 1. A persistent text-size preference (default / large / extra large)
 *    applied to every file and folder name in the room views.
 * 2. A hover magnifier that pops the hovered name up in large type near the
 *    pointer — explicitly opt-in because it annoys as many people as it helps.
 */

export type NameTextSize = 'default' | 'large' | 'xl';

export const NAME_TEXT_SIZES: { value: NameTextSize; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
];

// Class overrides relative to each surface's base size. The base name styles
// range text-sm..text-base, so 'large' and 'xl' step everything up uniformly.
const SIZE_CLASSES: Record<NameTextSize, string> = {
  default: '',
  large: 'text-base leading-6',
  xl: 'text-lg leading-7',
};

export function nameSizeClass(size: NameTextSize): string {
  return SIZE_CLASSES[size];
}

interface NameTextProps {
  name: string;
  size: NameTextSize;
  magnify: boolean;
  /** Base classes for the surface (truncate/clamp, weight, color). */
  className?: string;
  as?: 'span' | 'p';
}

/**
 * Renders a file/folder name honoring the size preference, with an optional
 * hover magnifier. The magnifier overlay is purely decorative (aria-hidden,
 * pointer-events-none) — the underlying name remains the accessible text.
 */
export function NameText({ name, size, magnify, className, as = 'span' }: NameTextProps) {
  const [magnifierPos, setMagnifierPos] = React.useState<{ x: number; y: number } | null>(null);
  const Tag = as;

  const handleEnter = magnify
    ? (e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMagnifierPos({ x: rect.left, y: rect.bottom + 6 });
      }
    : undefined;
  const handleLeave = magnify ? () => setMagnifierPos(null) : undefined;

  return (
    <>
      <Tag
        className={clsx(className, SIZE_CLASSES[size])}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {name}
      </Tag>
      {magnify &&
        magnifierPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-hidden="true"
            data-testid="name-magnifier"
            className="pointer-events-none fixed z-[200] max-w-[min(90vw,40rem)] rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xl font-semibold text-neutral-900 shadow-xl dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            style={{
              left: Math.min(magnifierPos.x, window.innerWidth - 400),
              top: Math.min(magnifierPos.y, window.innerHeight - 80),
            }}
          >
            {name}
          </div>,
          document.body
        )}
    </>
  );
}
