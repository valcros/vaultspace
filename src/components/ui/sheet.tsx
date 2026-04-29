'use client';

/**
 * Sheet — slide-in drawer built on Radix Dialog.
 *
 * Used for secondary surfaces that should overlay the primary content (e.g.
 * the "Manage room" drawer that holds Access, Share Links, Q&A, Checklist,
 * and Calendar). Slides in from the right by default. The Radix Dialog
 * primitive provides focus management, escape-to-close, and modal portal
 * behavior; the only custom thing here is the panel position + transition.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={clsx(
      'fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'right' | 'left';
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, side = 'right', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={clsx(
        'fixed inset-y-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl',
        'border-slate-200 dark:border-slate-800 dark:bg-slate-950',
        side === 'right' && 'right-0 border-l',
        side === 'left' && 'left-0 border-r',
        // Slide animation — keeps the visual cue that this is layered, not a page
        'transition-transform duration-200 ease-out',
        side === 'right' && 'data-[state=closed]:translate-x-full data-[state=open]:translate-x-0',
        side === 'left' && 'data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Close"
        className={clsx(
          'absolute right-4 top-4 rounded-md p-1.5',
          'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
          'dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
        )}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx('border-b border-slate-200 px-6 py-4 dark:border-slate-800', className)}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={clsx('text-lg font-semibold text-slate-950 dark:text-white', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={clsx('mt-1 text-sm text-slate-600 dark:text-slate-400', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx('flex-1 overflow-y-auto', className)} {...props} />
);
SheetBody.displayName = 'SheetBody';

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
};
