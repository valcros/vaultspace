import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';

const cardVariants = cva(
  'rounded-xl border bg-white text-neutral-900 transition-shadow duration-200 dark:bg-neutral-800 dark:text-neutral-100',
  {
    variants: {
      elevation: {
        flat: 'border-neutral-200 shadow-none dark:border-neutral-700',
        low: 'border-neutral-200 shadow-sm hover:shadow dark:border-neutral-700',
        medium: 'border-neutral-100 shadow hover:shadow-md dark:border-neutral-700',
        high: 'border-neutral-100 shadow-md hover:shadow-lg dark:border-neutral-600',
      },
    },
    defaultVariants: { elevation: 'low' },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation, ...props }, ref) => (
    <div ref={ref} className={clsx(cardVariants({ elevation }), className)} {...props} />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={clsx('flex flex-col space-y-1 px-5 py-4', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardHeaderTinted = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(
        'flex flex-row items-center justify-between px-5 py-3',
        'bg-neutral-50 dark:bg-neutral-700/50',
        'border-b border-neutral-100 dark:border-neutral-700',
        className
      )}
      {...props}
    />
  )
);
CardHeaderTinted.displayName = 'CardHeaderTinted';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={clsx('text-2xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={clsx('text-sm text-neutral-500 dark:text-neutral-400', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={clsx('px-5 pb-4', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={clsx('flex items-center p-6 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardHeaderTinted,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
};
