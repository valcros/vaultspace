'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { clsx } from 'clsx';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
    required?: boolean;
  }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={clsx(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    )}
    {...props}
  >
    {children}
    {required && <span className="ml-1 text-danger-500">*</span>}
  </LabelPrimitive.Root>
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
