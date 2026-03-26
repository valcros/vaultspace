'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('token');

  const [formData, setFormData] = React.useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
          inviteToken: inviteToken || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create account');
      }

      router.push('/rooms');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">Create an account</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {inviteToken ? 'Complete your registration to join' : 'Get started with VaultSpace'}
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              placeholder="Alice"
              value={formData.firstName}
              onChange={handleChange}
              required
              autoComplete="given-name"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              name="lastName"
              placeholder="Smith"
              value={formData.lastName}
              onChange={handleChange}
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={formData.email}
            onChange={handleChange}
            required
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            value={formData.password}
            onChange={handleChange}
            required
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="Confirm your password"
            value={formData.confirmPassword}
            onChange={handleChange}
            required
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" className="w-full" loading={isLoading}>
          Create account
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-neutral-500">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
          Sign in
        </Link>
      </div>
    </>
  );
}

function RegisterFormFallback() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">Create an account</h1>
        <p className="mt-1 text-sm text-neutral-500">Get started with VaultSpace</p>
      </div>
      <div className="animate-pulse space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="h-10 rounded bg-neutral-200" />
          <div className="h-10 rounded bg-neutral-200" />
        </div>
        <div className="h-10 rounded bg-neutral-200" />
        <div className="h-10 rounded bg-neutral-200" />
        <div className="h-10 rounded bg-neutral-200" />
        <div className="h-10 rounded bg-neutral-200" />
      </div>
    </>
  );
}

export default function RegisterPage() {
  return (
    <React.Suspense fallback={<RegisterFormFallback />}>
      <RegisterForm />
    </React.Suspense>
  );
}
