'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ExitSysopModeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exitMode() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sysop-mode', { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Could not end SysOp mode. Try again.');
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not end SysOp mode.');
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="outline" size="sm" type="button" onClick={exitMode} disabled={busy}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {busy ? 'Ending mode...' : 'Exit SysOp mode'}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
