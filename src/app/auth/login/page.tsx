'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberMe, setRememberMe] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 2FA state
  const [requiresTwoFactor, setRequiresTwoFactor] = React.useState(false);
  const [tempToken, setTempToken] = React.useState('');
  const [twoFactorCode, setTwoFactorCode] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign in');
      }

      // Check if 2FA is required
      if (data.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setTempToken(data.tempToken);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/2fa/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFactorCode, tempToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid verification code');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // 2FA verification screen
  if (requiresTwoFactor) {
    return (
      <>
        <div className="mb-6 text-center">
          <p className="text-xs font-medium text-primary-600">Security Check</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
            Two-Factor Authentication
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter the 6-digit code from your authenticator app, or use a backup code
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="twoFactorCode">Verification code</Label>
            <Input
              id="twoFactorCode"
              type="text"
              placeholder="Enter 6-digit code or backup code"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              required
              autoComplete="one-time-code"
              autoFocus
              maxLength={8}
            />
            <p className="text-xs text-slate-500">
              Backup codes also work here if you cannot access your authenticator app.
            </p>
          </div>

          <Button type="submit" className="w-full" loading={isLoading}>
            Verify
          </Button>

          <button
            type="button"
            onClick={() => {
              setRequiresTwoFactor(false);
              setTempToken('');
              setTwoFactorCode('');
              setError(null);
            }}
            className="w-full text-center text-sm text-neutral-500 hover:text-neutral-700"
          >
            Back to sign in
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <p className="text-xs font-medium text-primary-600">Secure Sign In</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-500">
          Sign in to your account to continue into your rooms and workflows.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
          <p className="text-xs text-slate-500">
            Use the work email associated with your organization or invitation.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/auth/forgot-password"
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <p className="text-xs text-slate-500">
            Your session is protected with secure, database-backed authentication.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="remember"
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(checked === true)}
          />
          <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
            Remember me for 30 days
          </Label>
        </div>

        <Button type="submit" className="w-full" loading={isLoading}>
          Sign in
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-neutral-500">
        Don&apos;t have an account?{' '}
        <Link href="/auth/register" className="font-medium text-primary-600 hover:text-primary-700">
          Sign up
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500">
        Need access? Ask a room or organization admin to invite you so VaultSpace can place you in
        the correct workspace automatically.
      </div>
    </>
  );
}
