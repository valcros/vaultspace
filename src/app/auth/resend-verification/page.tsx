'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResendVerificationPage() {
  const [email, setEmail] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = React.useState(0);

  React.useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // A 200 is intentionally privacy-neutral. A 429 applies before account
      // lookup and can be described generically without leaking account state.
      if (response.ok) {
        setSent(true);
      } else if (response.status === 429) {
        const retryAfter = Number.parseInt(response.headers.get('Retry-After') || '', 10);
        setRetryAfterSeconds(Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 60);
        setError(
          'For account protection, please wait before requesting another verification email. Check Spam, Junk, and your organization’s email quarantine first.'
        );
      } else {
        setError('We could not process that request. Please try again shortly.');
      }
    } catch {
      setError('We could not process that request. Please try again shortly.');
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Verify your email</h1>
        <p className="mt-3 text-sm text-slate-500">
          If an eligible unverified account uses{' '}
          <span className="font-medium text-slate-700">{email}</span>, a fresh verification link
          will arrive within a few minutes. Look for “Verify your email for VaultSpace” from
          noreply@vaultspace.org, including Spam, Junk, and your organization’s email quarantine.
          The link expires in 24 hours.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Resend verification</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter your email address. For privacy, we can&apos;t confirm whether an account is
          pending, but we&apos;ll send a new link when eligible.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" className="w-full" disabled={isLoading || retryAfterSeconds > 0}>
          {isLoading
            ? 'Sending…'
            : retryAfterSeconds > 0
              ? `Try again in ${retryAfterSeconds}s`
              : 'Send verification email'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
