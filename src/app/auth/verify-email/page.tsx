'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

type VerifyStatus = 'verifying' | 'verified' | 'already' | 'error';

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = React.useState<VerifyStatus>('verifying');
  const [error, setError] = React.useState<string | null>(null);
  const hasRun = React.useRef(false);

  React.useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    if (!token) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (res.ok && data.status === 'verified') {
          setStatus('verified');
          // The API set the session cookie (auto-login). Send them to the app.
          setTimeout(() => {
            router.push('/rooms');
            router.refresh();
          }, 1200);
        } else if (res.ok && data.status === 'already_verified') {
          setStatus('already');
        } else {
          setStatus('error');
          setError(data.error || 'This verification link is invalid or has expired.');
        }
      } catch {
        setStatus('error');
        setError('Something went wrong verifying your email. Please try again.');
      }
    })();
  }, [token, router]);

  if (status === 'verifying') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Verifying your email</h1>
        <p className="mt-2 text-sm text-slate-500">One moment while we confirm your account.</p>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Email verified</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account is ready. Taking you to your workspace&hellip;
        </p>
      </div>
    );
  }

  if (status === 'already') {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Already verified</h1>
        <p className="mt-2 text-sm text-slate-500">This account is already verified.</p>
        <p className="mt-6 text-sm">
          <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight text-slate-950">Verification failed</h1>
      <p className="mt-2 text-sm text-slate-500">{error}</p>
      <p className="mt-6 text-sm">
        <Link
          href="/auth/resend-verification"
          className="font-medium text-primary-600 hover:text-primary-700"
        >
          Request a new verification email
        </Link>
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      }
    >
      <VerifyEmailInner />
    </React.Suspense>
  );
}
