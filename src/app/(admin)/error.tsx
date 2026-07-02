'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[AdminError]', error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-warning-500" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Something went wrong
      </h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
        The page hit an unexpected error. Your documents and data are safe.
      </p>
      <Button className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
