'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/auth/login');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100">
            <svg
              className="h-6 w-6 text-danger-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">Invalid Reset Link</h1>
          <p className="mb-6 text-sm text-neutral-500">
            This password reset link is invalid or has expired.
          </p>
          <Link href="/auth/forgot-password">
            <Button className="w-full">Request a new link</Button>
          </Link>
        </div>

        <div className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
            Back to sign in
          </Link>
        </div>
      </>
    );
  }

  if (success) {
    return (
      <>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
            <svg
              className="h-6 w-6 text-success-600"
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
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">Password Reset</h1>
          <p className="mb-6 text-sm text-neutral-500">
            Your password has been successfully reset. Redirecting you to sign in...
          </p>
          <Link href="/auth/login">
            <Button className="w-full">Sign in now</Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">Set new password</h1>
        <p className="mt-1 text-sm text-neutral-500">Enter your new password below</p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Enter new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            autoFocus
          />
          <p className="text-xs text-neutral-500">Must be at least 8 characters</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" className="w-full" loading={isLoading}>
          Reset password
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-neutral-500">
        <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </div>
    </>
  );
}

function ResetPasswordFallback() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">Set new password</h1>
        <p className="mt-1 text-sm text-neutral-500">Enter your new password below</p>
      </div>
      <div className="animate-pulse space-y-4">
        <div className="h-10 rounded bg-neutral-200" />
        <div className="h-10 rounded bg-neutral-200" />
        <div className="h-10 rounded bg-neutral-200" />
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}
