'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <>
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6 text-success-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Check your email</h1>
          <p className="text-sm text-neutral-500 mb-6">
            We&apos;ve sent a password reset link to{' '}
            <span className="font-medium text-neutral-900">{email}</span>
          </p>
          <p className="text-sm text-neutral-500 mb-6">
            Didn&apos;t receive the email? Check your spam folder or try again.
          </p>
          <Button variant="outline" onClick={() => setSuccess(false)} className="w-full">
            Try another email
          </Button>
        </div>

        <div className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/auth/login" className="text-primary-600 hover:text-primary-700 font-medium">
            Back to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Reset your password</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Enter your email and we&apos;ll send you a reset link
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
        </div>

        <Button type="submit" className="w-full" loading={isLoading}>
          Send reset link
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-neutral-500">
        Remember your password?{' '}
        <Link href="/auth/login" className="text-primary-600 hover:text-primary-700 font-medium">
          Sign in
        </Link>
      </div>
    </>
  );
}
