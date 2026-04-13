'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const RELATIONSHIP_TYPES = [
  { value: 'investor', label: 'Investor' },
  { value: 'legal_advisor', label: 'Legal Advisor' },
  { value: 'financial_advisor', label: 'Financial Advisor' },
  { value: 'business_advisor', label: 'Business Advisor' },
  { value: 'board_member', label: 'Board Member' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'partner', label: 'Partner' },
  { value: 'employee', label: 'Employee' },
  { value: 'other', label: 'Other' },
];

interface InviteInfo {
  email: string;
  role: string;
  organizationName: string;
}

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
    title: '',
    relationship: '',
  });
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = React.useState<InviteInfo | null>(null);
  const [inviteLoading, setInviteLoading] = React.useState(!!inviteToken);

  // Fetch invitation details to pre-populate email
  React.useEffect(() => {
    if (!inviteToken) {
      return;
    }
    fetch(`/api/invitations/${inviteToken}`)
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        throw new Error('Invalid invitation');
      })
      .then((data: InviteInfo) => {
        setInviteInfo(data);
        setFormData((prev) => ({ ...prev, email: data.email }));
      })
      .catch(() => {
        setError('This invitation is invalid or has expired.');
      })
      .finally(() => {
        setInviteLoading(false);
      });
  }, [inviteToken]);

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
          title: formData.title || undefined,
          relationship: formData.relationship || undefined,
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
        <p className="text-xs font-medium text-primary-600">
          Account Setup
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">Create an account</h1>
        <p className="mt-2 text-sm text-slate-500">
          {inviteInfo
            ? `You've been invited to join ${inviteInfo.organizationName}`
            : inviteToken
              ? 'Complete your registration to join'
              : 'Get started with VaultSpace'}
        </p>
      </div>

      {inviteLoading && (
        <div className="mb-6 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      )}

      {inviteInfo && (
        <div className="mb-6 rounded-2xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
          You&apos;re joining <span className="font-semibold">{inviteInfo.organizationName}</span>{' '}
          as a <span className="font-semibold lowercase">{inviteInfo.role}</span>.
        </div>
      )}

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
            readOnly={!!inviteInfo}
            className={inviteInfo ? 'bg-neutral-50 text-neutral-600' : ''}
          />
          {inviteInfo && (
            <p className="text-xs text-slate-500">
              Email is set from your invitation and cannot be changed
            </p>
          )}
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
          <p className="text-xs text-slate-500">
            Use at least 8 characters. A passphrase is better than a short password.
          </p>
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

        {inviteInfo && (
          <>
            <div className="space-y-2">
              <Label htmlFor="title">Title / Position</Label>
              <Input
                id="title"
                name="title"
                placeholder="e.g., Managing Partner, VP of Finance"
                value={formData.title}
                onChange={handleChange}
                autoComplete="organization-title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="relationship">Relationship to Organization</Label>
              <Select
                value={formData.relationship}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, relationship: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select your role..." />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

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

      {!inviteInfo && (
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500">
          For the best experience, create accounts through an invitation so your organization, room
          access, and onboarding context are preconfigured.
        </div>
      )}
    </>
  );
}

function RegisterFormFallback() {
  return (
    <>
      <div className="mb-6 text-center">
        <p className="text-xs font-medium text-primary-600">
          Account Setup
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">Create an account</h1>
        <p className="mt-2 text-sm text-slate-500">Get started with VaultSpace</p>
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
