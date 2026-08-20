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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // The endpoint is privacy-neutral (always succeeds), so we show the same
      // confirmation regardless of whether the account exists.
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Swallow — the confirmation is intentionally identical either way.
    } finally {
      setIsLoading(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Check your email</h1>
        <p className="mt-3 text-sm text-slate-500">
          If an unverified account exists for{' '}
          <span className="font-medium text-slate-700">{email}</span>, a new verification link is on
          its way. It expires in 24 hours.
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
          Enter your email and we&apos;ll send a fresh verification link.
        </p>
      </div>
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
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Sending…' : 'Send verification email'}
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
