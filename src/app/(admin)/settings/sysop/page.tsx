'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Reason = 'PLATFORM_MAINTENANCE' | 'SUPPORT' | 'INCIDENT';

export default function SysopModePage() {
  const router = useRouter();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [enrollmentEnabled, setEnrollmentEnabled] = useState(false);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState<Reason>('PLATFORM_MAINTENANCE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Could not load security settings');
        }
        return response.json();
      })
      .then((data) => {
        setTwoFactorEnabled(Boolean(data.user?.twoFactorEnabled));
        setEnrollmentEnabled(Boolean(data.twoFactorEnrollmentEnabled));
      })
      .catch(() => setError('Could not load security settings'));
  }, []);

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sysop-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not enter SysOp mode');
      }
      router.replace('/sysop');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enter SysOp mode');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>Enter SysOp mode</CardTitle>
          <CardDescription>
            SysOp mode grants temporary platform access for up to 30 minutes and ends after 10
            minutes of inactivity. Your entry, actions, and exit are recorded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {twoFactorEnabled === false ? (
            <p className="text-sm">
              Set up two-factor authentication in{' '}
              <Link className="underline" href="/settings/security">
                Security settings
              </Link>
              {enrollmentEnabled
                ? ' before entering SysOp mode.'
                : '. Enrollment is currently unavailable; ask the platform owner to enable it after validation.'}
            </p>
          ) : (
            <form onSubmit={enter} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="sysop-reason" className="text-sm font-medium">
                  Reason for access
                </label>
                <select
                  id="sysop-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value as Reason)}
                  className="border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <option value="PLATFORM_MAINTENANCE">Platform maintenance</option>
                  <option value="SUPPORT">Support</option>
                  <option value="INCIDENT">Incident response</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="sysop-code" className="text-sm font-medium">
                  Authenticator code
                </label>
                <Input
                  id="sysop-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || twoFactorEnabled !== true}>
                {busy ? 'Verifying...' : 'Enter SysOp mode'}
              </Button>
            </form>
          )}
          {twoFactorEnabled === false && error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
