'use client';

import * as React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { CircleHelp } from 'lucide-react';

/** Supplemental help available on hover/focus and by click/tap. */
export function ContextHelp({ label, children }: { label: string; children: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const suppressTooltip = React.useRef(false);
  const contentClass =
    'z-[100] max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';

  return (
    <Tooltip.Provider delayDuration={300}>
      <Popover.Root
        open={expanded}
        onOpenChange={(open) => {
          suppressTooltip.current = !open;
          setHovered(false);
          setExpanded(open);
        }}
      >
        <Tooltip.Root
          open={!expanded && hovered}
          onOpenChange={(open) => setHovered(open && !suppressTooltip.current)}
        >
          <Popover.Trigger asChild>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={label}
                onPointerEnter={() => {
                  if (!expanded) {
                    suppressTooltip.current = false;
                  }
                }}
                onBlur={() => {
                  suppressTooltip.current = false;
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip.Trigger>
          </Popover.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content sideOffset={6} collisionPadding={12} className={contentClass}>
              {children}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Popover.Portal>
          <Popover.Content
            aria-label={label}
            sideOffset={6}
            collisionPadding={12}
            className={contentClass}
          >
            <p>{children}</p>
            <Popover.Close className="mt-2 rounded px-2 py-1 font-medium text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300">
              Close help
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Tooltip.Provider>
  );
}
