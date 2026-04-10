import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';

const cardVariants = cva(
  'rounded-2xl border bg-white/88 text-neutral-900 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-200 dark:bg-neutral-900/82 dark:text-neutral-100',
  {
    variants: {
      elevation: {
        flat: 'border-neutral-200/80 shadow-none dark:border-neutral-700/80',
        low: 'border-white/70 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.38)] hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-26px_rgba(37,99,235,0.28)] dark:border-neutral-700/80',
        medium:
          'border-white/80 shadow-[0_16px_38px_-24px_rgba(15,23,42,0.42)] hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-26px_rgba(37,99,235,0.3)] dark:border-neutral-700/80',
        high: 'border-white/80 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.48)] hover:-translate-y-0.5 hover:shadow-[0_28px_52px_-26px_rgba(37,99,235,0.32)] dark:border-neutral-700/80',
      },
    },
    defaultVariants: { elevation: 'low' },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

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
