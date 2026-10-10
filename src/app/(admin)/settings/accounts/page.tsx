'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Account {
  userId: string;
  email: string;
  organizationName: string | null;
  isCurrent: boolean;
  isPrimary: boolean;
  available: boolean;
  linkId: string | null;
}

interface AccountState {
  isPrimary: boolean;
  switchingActive: boolean;
  expiresAt: string | null;
  accounts: Account[];
}

async function mutate(url: string, method: 'POST' | 'DELETE', body?: object) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Account operation failed');
  }
  return result;
}

export default function AccountsPage() {
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [enrollmentEnabled, setEnrollmentEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [primaryPassword, setPrimaryPassword] = useState('');
  const [primaryCode, setPrimaryCode] = useState('');
  const [secondaryEmail, setSecondaryEmail] = useState('');
  const [secondaryPassword, setSecondaryPassword] = useState('');
  const [secondaryCode, setSecondaryCode] = useState('');
  const [unlinkId, setUnlinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accountsResponse, meResponse] = await Promise.all([
      fetch('/api/auth/account-links', { cache: 'no-store' }),
      fetch('/api/auth/me', { cache: 'no-store' }),
    ]);
    if (!accountsResponse.ok || !meResponse.ok) {
      throw new Error('Could not load account settings');
    }
    const accounts = await accountsResponse.json();
    const me = await meResponse.json();
    setAccountState(accounts);
    setMfaEnabled(Boolean(me.user?.twoFactorEnabled));
    setEnrollmentEnabled(Boolean(me.twoFactorEnrollmentEnabled));
  }, []);

  useEffect(() => {
    load()
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not load accounts')
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account operation failed');
    } finally {
      setBusy(false);
    }
  }

  function clearProof() {
    setPrimaryPassword('');
    setPrimaryCode('');
    setSecondaryPassword('');
    setSecondaryCode('');
  }

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await mutate('/api/auth/account-links', 'POST', {
        primaryPassword,
        primaryCode,
        secondaryEmail,
        secondaryPassword,
        secondaryCode: secondaryCode || undefined,
      });
      clearProof();
      setSecondaryEmail('');
      setSuccess('Account linked. Its roles and organization access remain separate.');
      await load();
    });
  }

  async function startSwitching(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await mutate('/api/auth/account-switch/start', 'POST', {
        password: primaryPassword,
        code: primaryCode,
      });
      clearProof();
      setSuccess('Account switching is active for up to 30 minutes.');
      await load();
    });
  }

  async function unlink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlinkId) {
      return;
    }
    await run(async () => {
      await mutate('/api/auth/account-links', 'DELETE', {
        linkId: unlinkId,
        primaryPassword,
        primaryCode,
      });
      clearProof();
      setUnlinkId(null);
      setSuccess('Account unlinked. The current switching window has ended.');
      await load();
    });
  }

  async function switchTo(targetUserId: string) {
    await run(async () => {
      await mutate('/api/auth/account-switch', 'POST', { targetUserId });
      // A full navigation discards all client-side tenant data and query caches.
      window.location.replace('/dashboard');
    });
  }

  async function stopSwitching() {
    await run(async () => {
      await mutate('/api/auth/account-switch', 'DELETE');
      setSuccess('Account switching ended. You remain in the current account.');
      await load();
    });
  }

  const linkedCount = accountState?.accounts.filter((account) => !account.isPrimary).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Link accounts you own, then switch within a short window verified by your primary
            account. Each account keeps its own rooms, organization roles, and audit history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm">Loading accounts...</p>}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-sm text-green-700">
              {success}
            </p>
          )}
          {accountState && (
            <>
              <ul className="divide-y rounded-md border">
                {accountState.accounts.map((account) => (
                  <li
                    key={account.userId}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{account.email}</p>
                      <p className="text-muted-foreground">
                        {account.organizationName ?? 'No active organization'}
                        {account.isPrimary ? ' · Primary' : ''}
                        {account.isCurrent ? ' · Current' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {accountState.switchingActive && !account.isCurrent && account.available && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => switchTo(account.userId)}
                        >
                          Switch
                        </Button>
                      )}
                      {accountState.isPrimary && account.linkId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setUnlinkId(account.linkId)}
                        >
                          Unlink
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {accountState.switchingActive && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm">
                    Switching window ends{' '}
                    {accountState.expiresAt
                      ? new Date(accountState.expiresAt).toLocaleTimeString()
                      : 'soon'}
                    .
                  </p>
                  <Button type="button" variant="outline" disabled={busy} onClick={stopSwitching}>
                    End switching
                  </Button>
                </div>
              )}
              {!accountState.isPrimary && !accountState.switchingActive && (
                <p className="text-sm">
                  Sign in to your primary account to start a new switching window.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {accountState?.isPrimary && (
        <Card>
          <CardHeader>
            <CardTitle>{unlinkId ? 'Unlink account' : 'Primary account verification'}</CardTitle>
            <CardDescription>
              Enter your primary password and authenticator code to manage links or start switching.
              {mfaEnabled === false && (
                <>
                  {' '}
                  Set up two-factor authentication in{' '}
                  <Link href="/settings/security" className="underline">
                    Security settings
                  </Link>
                  {enrollmentEnabled
                    ? ' first.'
                    : '. Enrollment is currently unavailable until the platform owner enables it after validation.'}
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="primary-password" className="text-sm font-medium">
                Primary account password
              </label>
              <Input
                id="primary-password"
                type="password"
                autoComplete="current-password"
                value={primaryPassword}
                onChange={(event) => setPrimaryPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="primary-code" className="text-sm font-medium">
                Primary authenticator code
              </label>
              <Input
                id="primary-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={primaryCode}
                onChange={(event) => setPrimaryCode(event.target.value)}
                required
              />
            </div>
            {unlinkId ? (
              <form onSubmit={unlink} className="space-y-3">
                <p className="text-sm">
                  This ends the current switching window for all linked accounts.
                </p>
                <Button
                  disabled={busy || mfaEnabled !== true || !primaryPassword || !primaryCode}
                  type="submit"
                >
                  Unlink account
                </Button>{' '}
                <Button type="button" variant="outline" onClick={() => setUnlinkId(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                {linkedCount > 0 && !accountState.switchingActive && (
                  <form onSubmit={startSwitching}>
                    <Button
                      disabled={busy || mfaEnabled !== true || !primaryPassword || !primaryCode}
                      type="submit"
                    >
                      Start switching
                    </Button>
                  </form>
                )}
                <form onSubmit={link} className="space-y-4 border-t pt-6">
                  <h2 className="font-semibold">Link another account</h2>
                  <p className="text-muted-foreground text-sm">
                    Prove control with that account’s password and authenticator code, if enabled.
                  </p>
                  <div className="space-y-2">
                    <label htmlFor="secondary-email" className="text-sm font-medium">
                      Secondary account email
                    </label>
                    <Input
                      id="secondary-email"
                      type="email"
                      autoComplete="email"
                      value={secondaryEmail}
                      onChange={(event) => setSecondaryEmail(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="secondary-password" className="text-sm font-medium">
                      Secondary account password
                    </label>
                    <Input
                      id="secondary-password"
                      type="password"
                      autoComplete="current-password"
                      value={secondaryPassword}
                      onChange={(event) => setSecondaryPassword(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="secondary-code" className="text-sm font-medium">
                      Secondary authenticator code, if enabled
                    </label>
                    <Input
                      id="secondary-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={secondaryCode}
                      onChange={(event) => setSecondaryCode(event.target.value)}
                    />
                  </div>
                  <Button
                    disabled={busy || mfaEnabled !== true || !primaryPassword || !primaryCode}
                    type="submit"
                  >
                    Link account
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
